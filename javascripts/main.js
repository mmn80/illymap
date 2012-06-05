"use strict";

var TOWNS_XML = "data/datafile_towns.xml";
var ALLIANCES_XML = "data/datafile_alliances.xml";
var DATA_JSON = "data/data.json";
var BG_IMAGE = "images/region_faction_map.png";
var STAR_IMAGE = "images/star.gif";

var MAP_WIDTH = 1000;
var OVR_NONE = "none", OVR_POP = "pop", OVR_PAR = "par";        // overlay modes: none, population density in false colors, or map partition
var OVR_PAR_RACES = "races", OVER_PAR_ALLIANCES = "alliances",
  OVER_PAR_CONFEDS = "confeds";                                 // submodes for partition mode
var PAR_COLORS = [ [0xFF,0,0]/*red*/, [0,0xFF,0]/*lime*/, [0,0,0xFF]/*blue*/, [0xFF,0xFF,0]/*yellow*/, [0,0xFF,0xFF]/*cyan*/,
  [0xFF,0,0xFF]/*fuchsia*/, [0xFF,0xA5,0]/*orange*/, [0,0x80,0]/*green*/, [0x80,0x80,0]/*olive*/, [0,0,0xA0]/*darkblue*/,
  [0xA5,0x2A,0x2A]/*brown*/, [0x80,0,0x80]/*purple*/, [0xAD,0xD8,0xE6]/*lightblue*/, [0x80,0,0]/*maroon*/, [0xC0,0xC0,0xC0]/*silver*/ ];

var data = { server: "", date: "", alliances: [], towns: [] }; // data loaded from the json file, generated based on the Illy-supplied xmls

var capitals = []; // prefiltered list of alliance capitals
var map_state = {
  mx: 0,           // mousex
  my: 0,           // mousey
  sel_cap: null    // selected (mouse over) alliance capital
};

var overlay = {    // object containing overlay data
  rgb: null,       // OUT: overlay rgb Uint8Array; this is the end result of all overlay computations
  std_dev: 15,     // IN: standard deviation
  mode: OVR_NONE,  // IN: overlay mode
  race: "",        // IN: race filter: "", "E", "H", "D", "O"
  par_mode: "",    // IN: partition submode
  density: null,   // MAP_WIDTHxMAP_WIDTH Float32Array, values represent populations; used for OVR_POP overlays
  max_density: 0,  // max value in the density matrix (used for normalization)
  buffers: [],     // map overlay array buffers used for partition calculations (OVR_PAR), with elements of the form:
                   // { partition: Uint8Array: partition_ids for each cell,
                   //   is_output: Uint8Array of bit flags: temp flag (the first pass stores values in temp buffer)
                   //   density: Float32Array: population density for each cell }
  partitions: [],  // lookup table for partitions, partition_id is index+1 (0=not allocated), with elements of the form:
                   // { value: alliance_ID_or_race(based on par_mode),
                   //   name: display_name,
                   //   pop: total_population,
                   //   area: total_domination_area }
  dominators: null,// Uint8Array containing the partition_ids with most population among all buffers
  kernels: []      // precomputed gaussian distributions of form { std_dev: val, buffer: Float32Array }
}

var gl, shaderProgram;
var mvMatrix = mat4.create(), pMatrix = mat4.create();
var buffers = { mapPos: null, mapTexPos: null, starsPos: null, starsTexPos: null, selStarPos: null, selStarTexPos: null };
var bg_tex, star_tex;






// initialization ******************************************************************

$(document).ready(function () {
  if (!init_webgl()) return;
  var bg_loaded = false, star_loaded = false, data_loaded = false;
  bg_tex.image.onload = function() {
    gl.bindTexture(gl.TEXTURE_2D, bg_tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bg_tex.image);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    bg_loaded = true;
    if (data_loaded && star_loaded) init_data();
  };
  star_tex.image.onload = function() {
    gl.bindTexture(gl.TEXTURE_2D, star_tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, star_tex.image);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.bindTexture(gl.TEXTURE_2D, null);
    star_loaded = true;
    if (data_loaded && bg_loaded) init_data();
  };
  $("#show_map").click(paint);
  $("#show_towns").click(paint);
  $("#show_capitals").click(paint);
  $("#overlay_mode").change(recompute_overlay);
  $("#std_dev").change(recompute_overlay);
  $("#xml2json_btn").click(loadXml);
  $("#map").mousemove(map_mousemove);
  bg_tex.image.src = BG_IMAGE;
  star_tex.image.src = STAR_IMAGE;
  $.getJSON(DATA_JSON, function(d) {
    data = d;
    data_loaded = true;
    if (bg_loaded && star_loaded) init_data();
  });
});

function init_data() {
  $("#server_info").html("server: " + data.server + "<br/>date: " + data.date.substring(0, 10));
  capitals = [];
  for (var i=0; i<data.towns.length; i++) {
    var town = data.towns[i];
    town.x1 = Math.round((town.x + MAP_WIDTH) / 2);
    town.y1 = -Math.round((town.y + MAP_WIDTH) / 2) + MAP_WIDTH;
    if (town.r === undefined)
      town.r = "H";
    if (town.c == 1) {
      town.alliance = "?";
      for (var j=0; j<data.alliances.length; j++) {
        var a = data.alliances[j];
        if (a.id == town.a) {
          town.alliance = a.name;
          break;
        }
      }
      capitals.push(town);
    }
  }
  capitals.sort(function(a, b) { // we need this for proper mouse over triggering when capitals overlap
    return a.p - b.p;
  });
  initDataBuffers();
  paint();
}

function init_webgl() {
  var canvas = $("#map")[0];
  try {
    gl = canvas.getContext("experimental-webgl");
    gl.viewportWidth = canvas.width;
    gl.viewportHeight = canvas.height;
  }
  catch (e) {}
  if (!gl) {
    alert("Could not initialise WebGL, sorry :-(");
    return false;
  }
  else {
    if (!initShaders()) return false;
    initBuffers();
    bg_tex = gl.createTexture();
    bg_tex.image = new Image();
    star_tex = gl.createTexture();
    star_tex.image = new Image();
    gl.clearColor(0.0, 0.0, 0.0, 1.0);
    return true;
  }
}

function initShaders() {
  var fragmentShader = getShader(gl, "shader-fs");
  var vertexShader = getShader(gl, "shader-vs");

  shaderProgram = gl.createProgram();
  gl.attachShader(shaderProgram, vertexShader);
  gl.attachShader(shaderProgram, fragmentShader);
  gl.linkProgram(shaderProgram);

  if (!gl.getProgramParameter(shaderProgram, gl.LINK_STATUS)) {
    alert("Could not initialise shaders.");
    return false;
  }
  else {
    gl.useProgram(shaderProgram);

    shaderProgram.aVertexPosition = gl.getAttribLocation(shaderProgram, "aVertexPosition");
    gl.enableVertexAttribArray(shaderProgram.aVertexPosition);

    shaderProgram.aTextureCoord = gl.getAttribLocation(shaderProgram, "aTextureCoord");
    gl.enableVertexAttribArray(shaderProgram.aTextureCoord);

    shaderProgram.uPMatrix = gl.getUniformLocation(shaderProgram, "uPMatrix");
    shaderProgram.uMVMatrix = gl.getUniformLocation(shaderProgram, "uMVMatrix");
    shaderProgram.uMapSampler = gl.getUniformLocation(shaderProgram, "uMapSampler");
    shaderProgram.uStarSampler = gl.getUniformLocation(shaderProgram, "uStarSampler");
    shaderProgram.uGreyBg = gl.getUniformLocation(shaderProgram, "uGreyBg");
    shaderProgram.uColor = gl.getUniformLocation(shaderProgram, "uColor");
    shaderProgram.uStars = gl.getUniformLocation(shaderProgram, "uStars");

    return true;
  }
}

function getShader(gl, id) {
  var shaderScript = $("#" + id)[0];
  if (!shaderScript) return null;
  var str = "";
  var k = shaderScript.firstChild;
  while (k) {
    if (k.nodeType == 3)
      str += k.textContent;
    k = k.nextSibling;
  }
  var shader;
  if (shaderScript.type == "x-shader/x-fragment")
    shader = gl.createShader(gl.FRAGMENT_SHADER);
  else if (shaderScript.type == "x-shader/x-vertex")
    shader = gl.createShader(gl.VERTEX_SHADER);
  else return null;
  gl.shaderSource(shader, str);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      alert(gl.getShaderInfoLog(shader));
      return null;
  }
  return shader;
}

function initBuffers() {
  buffers.mapPos = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.mapPos);
  var vertices = [
       0.0, 0.0,  0.0,
       MAP_WIDTH,  0.0,  0.0,
       0.0,  MAP_WIDTH,  0.0,
       MAP_WIDTH,  MAP_WIDTH,  0.0
  ];
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
  buffers.mapPos.itemSize = 3;
  buffers.mapPos.numItems = 4;

  buffers.mapTexPos = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.mapTexPos);
  var textureCoords = [
      0.0, 0.0,
      1.0, 0.0,
      0.0, 1.0,
      1.0, 1.0
  ];
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(textureCoords), gl.STATIC_DRAW);
  buffers.mapTexPos.itemSize = 2;
  buffers.mapTexPos.numItems = 4;
}

function get_town_pos(town, is_selected) {
  var r = Math.floor(Math.sqrt(town.p / 100));
  if (is_selected) r *= 1.2;
  if (r < 4) r = 4;
  var x = town.x1 - r, y = MAP_WIDTH - town.y1 - r;
  return { x: x, y: y, r: r }
}

function initDataBuffers() {
  var vtx_pos = [
       0.0, 0.0, 0.0,
       1.0, 0.0, 0.0,
       0.0, 1.0, 0.0,
       1.0, 0.0, 0.0,
       0.0, 1.0, 0.0,
       1.0, 1.0, 0.0
  ];

  buffers.starsPos = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.starsPos);
  var vertices = [];
  for (var i=0; i<capitals.length; i++) {
    var pos = get_town_pos(capitals[i], false);
    for (var j=0; j<vtx_pos.length; j+=3) {
      vertices.push(vtx_pos[j] * 2 * pos.r + pos.x);
      vertices.push(vtx_pos[j + 1] * 2 * pos.r + pos.y);
      vertices.push(vtx_pos[j + 2] - 1.0);
    }
  }
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
  buffers.starsPos.itemSize = 3;
  buffers.starsPos.numItems = capitals.length * 6;

  var tex_pos = [
      0.0, 0.0,
      1.0, 0.0,
      0.0, 1.0,
      1.0, 0.0,
      0.0, 1.0,
      1.0, 1.0
  ];
  buffers.starsTexPos = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.starsTexPos);
  var textureCoords = [];
  for (var i=0; i<capitals.length; i++)
    for (var j=0; j<tex_pos.length; j++)
      textureCoords.push(tex_pos[j]);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(textureCoords), gl.STATIC_DRAW);
  buffers.starsTexPos.itemSize = 2;
  buffers.starsTexPos.numItems = capitals.length * 6;

  buffers.selStarPos = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.selStarPos);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vtx_pos), gl.STATIC_DRAW);
  buffers.selStarPos.itemSize = 3;
  buffers.selStarPos.numItems = 6;

  buffers.selStarTexPos = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.selStarTexPos);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(tex_pos), gl.STATIC_DRAW);
  buffers.selStarTexPos.itemSize = 2;
  buffers.selStarTexPos.numItems = 6;
}






// paint ************************************************************************

function paint() {
  var v_map = $("#show_map").is(':checked');
  var v_tow = $("#show_towns").is(':checked');
  var v_cap = $("#show_capitals").is(':checked');

  gl.viewport(0, 0, gl.viewportWidth, gl.viewportHeight);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
  gl.enable(gl.BLEND);
  //gl.disable(gl.DEPTH_TEST);

  mat4.ortho(0, MAP_WIDTH, 0, MAP_WIDTH, 0, 10, pMatrix);
  gl.uniformMatrix4fv(shaderProgram.uPMatrix, false, pMatrix);

  // paint background map

  if (v_map) {
    mat4.identity(mvMatrix);
    mat4.translate(mvMatrix, [0.0, 0.0, -5.0]);

    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.mapTexPos);
    gl.vertexAttribPointer(shaderProgram.aTextureCoord, buffers.mapTexPos.itemSize, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.mapPos);
    gl.vertexAttribPointer(shaderProgram.aVertexPosition, buffers.mapPos.itemSize, gl.FLOAT, false, 0, 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, bg_tex);
    gl.uniform1i(shaderProgram.uMapSampler, 0);

    gl.uniformMatrix4fv(shaderProgram.uMVMatrix, false, mvMatrix);
    gl.uniform1i(shaderProgram.uGreyBg, v_cap || v_tow || overlay.mode != OVR_NONE);
    gl.uniform1i(shaderProgram.uStars, false);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, buffers.mapPos.numItems);
  }

  //paint capitals

  if (v_cap) {
    mat4.identity(mvMatrix);

    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.starsTexPos);
    gl.vertexAttribPointer(shaderProgram.aTextureCoord, buffers.starsTexPos.itemSize, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.starsPos);
    gl.vertexAttribPointer(shaderProgram.aVertexPosition, buffers.starsPos.itemSize, gl.FLOAT, false, 0, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, star_tex);

    gl.uniform1i(shaderProgram.uStarSampler, 1);
    gl.uniform1i(shaderProgram.uStars, true);
    gl.uniform3f(shaderProgram.uColor, 232 / 255, 222 / 255, 49 / 255);
    gl.uniformMatrix4fv(shaderProgram.uMVMatrix, false, mvMatrix);

    gl.drawArrays(gl.TRIANGLES, 0, buffers.starsPos.numItems);

    if (map_state.sel_cap) {
      var pos = get_town_pos(map_state.sel_cap, true);
      mat4.identity(mvMatrix);
      mat4.translate(mvMatrix, [pos.x, pos.y, -1.0]);
      mat4.scale(mvMatrix, [2 * pos.r, 2 * pos.r, 1.0]);

      gl.bindBuffer(gl.ARRAY_BUFFER, buffers.selStarTexPos);
      gl.vertexAttribPointer(shaderProgram.aTextureCoord, buffers.selStarTexPos.itemSize, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, buffers.selStarPos);
      gl.vertexAttribPointer(shaderProgram.aVertexPosition, buffers.selStarPos.itemSize, gl.FLOAT, false, 0, 0);

      gl.uniform3f(shaderProgram.uColor, 0 / 255, 255 / 255, 0 / 255);
      gl.uniformMatrix4fv(shaderProgram.uMVMatrix, false, mvMatrix);

      gl.drawArrays(gl.TRIANGLES, 0, buffers.selStarPos.numItems);
    }

    /*for (var i=0; i<capitals.length; i++) {
      var town = capitals[i];
      var r = Math.floor(Math.sqrt(town.p / 300));
      if (r < 2) r = 2;
      r *= 2;
      if (town == map_state.sel_cap) r *= 1.2;
      var x = town.x1 - r, y = MAP_WIDTH - town.y1 - r;
      mat4.identity(mvMatrix);
      mat4.translate(mvMatrix, [x, y, -1.0]);
      mat4.scale(mvMatrix, [r / 64, r / 64, 1.0]);
      var color = (town == map_state.sel_cap ?  { r: 0, g: 255, b: 0 } : { r: 232, g: 222, b: 49 })

      gl.uniform3f(shaderProgram.uColor, color.r / 255, color.g / 255, color.b / 255);
      gl.uniformMatrix4fv(shaderProgram.uMVMatrix, false, mvMatrix);
      gl.drawArrays(gl.TRIANGLES, 0, buffers.starsPos.numItems);
    }*/
  }
}

function paint2D() {
  var ctx = $("#map")[0].getContext("2d");

  //clear canvas or paint background image

  if ($("#show_map").is(':checked')) {
    ctx.drawImage(bg_tex.image, 0, 0, MAP_WIDTH, MAP_WIDTH);
    if (overlay.mode == OVR_NONE) {
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.rect(0, 0, MAP_WIDTH, MAP_WIDTH);
      ctx.fillStyle = "black";
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }
  else ctx.clearRect(0, 0, MAP_WIDTH, MAP_WIDTH);

  var imgd = ctx.getImageData(0, 0, MAP_WIDTH, MAP_WIDTH);

  //paint overlays

  if (overlay.mode != OVR_NONE) {
      var alpha = 0.5, len = overlay.rgb.byteLength / 3;
      if (!$("#show_map").is(':checked')) alpha = 0;
      for (var i=0; i<len; i++) {
        var idx = i * 4, idx1 = i * 3;
        var grey = alpha * (0.34 * imgd.data[idx] + 0.5 * imgd.data[idx + 1] + 0.16 * imgd.data[idx + 2]);
        imgd.data[idx] = Math.floor(grey + (1 - alpha) * overlay.rgb[idx1]);
        imgd.data[idx + 1] = Math.floor(grey + (1 - alpha) * overlay.rgb[idx1 + 1]);
        imgd.data[idx + 2] = Math.floor(grey + (1 - alpha) * overlay.rgb[idx1 + 2]);
        imgd.data[idx + 3] = 255;
      }
  }

  //paint towns

  if ($("#show_towns").is(':checked'))
    for (var i=0; i<data.towns.length; i++) {
      var town = data.towns[i];
      if (town.c != 1) {
        var idx = (town.x1 + (town.y1 * MAP_WIDTH)) * 4;
        imgd.data[idx] = 0;
        imgd.data[idx + 1] = 0;
        imgd.data[idx + 2] = 255;
        imgd.data[idx + 3] = 255;
      }
    }

  ctx.putImageData(imgd, 0, 0);

  //paint capitals

  if ($("#show_capitals").is(':checked'))
    for (var i=0; i<capitals.length; i++) {
      var town = capitals[i];
      var r = Math.floor(Math.sqrt(town.p / 300));
      if (r < 2) r = 2;
      ctx.beginPath();
      var grd = ctx.createRadialGradient(town.x1, town.y1, 1, town.x1, town.y1, r);
      grd.addColorStop(0, 'rgba(232,222,49,1)');
      grd.addColorStop(1, 'rgba(232,222,49,0)');
      ctx.fillStyle = grd;
      ctx.arc(town.x1, town.y1, r, 0, Math.PI*2, false);
      ctx.fill();
    }

  //paint selected capital infobox

  if (map_state.sel_cap)
    info_box(ctx, map_state.sel_cap.x1 + 20, map_state.sel_cap.y1 - 10, [
      { text: map_state.sel_cap.name, italic: true },
      { text: "capital of " + map_state.sel_cap.alliance },
      { text: "population " + map_state.sel_cap.p }
    ]);
}





// control *********************************************************************

function map_mousemove(event) {
  var old_sel_cap = map_state.sel_cap;
  map_state.sel_cap = null;
  map_state.mx = event.pageX - this.offsetLeft;
  map_state.my = event.pageY - this.offsetTop;
  if ($("#show_capitals").is(':checked'))
    for (var i=0; i<capitals.length; i++) {
        var town = capitals[i];
        var r = Math.floor(Math.sqrt(town.p / 300));
        if (r < 2) r = 2;
        var dist = Math.sqrt(Math.pow(town.x1 - map_state.mx, 2) + Math.pow(town.y1 - map_state.my, 2));
        if (dist <= r) {
          map_state.sel_cap = town;
          break;
        }
    }
  if (map_state.sel_cap != old_sel_cap) {
    if (!map_state.sel_cap)
      $("#infobox").hide();
    else {
      $("#infobox").html("<i>" + map_state.sel_cap.name + "</i><br />" +
        "capital of " + map_state.sel_cap.alliance + "<br />" +
        "population " + map_state.sel_cap.p);
      var pos = $("#map").position();
      $("#infobox").css({
          position: "absolute",
          top: (pos.top + town.y1 - 60) + "px",
          left: (pos.left + town.x1 + 15) + "px"
      }).show();
    }
    paint();
  }
}

function recompute_overlay() {
  overlay.std_dev = parseInt($("#std_dev").val());
  overlay.mode = $("#overlay_mode").val();
  if (overlay.mode.indexOf(OVR_POP) == 0) {
    overlay.race = overlay.mode.substring(OVR_POP.length + 1);
    overlay.mode = OVR_POP;
  }
  else if (overlay.mode.indexOf(OVR_PAR) == 0) {
    overlay.par_mode = overlay.mode.substring(OVR_PAR.length + 1);
    overlay.mode = OVR_PAR;
  }

  // search for cached Gaussian kernel

  var kernel = null;
  for (var i=0; i<overlay.kernels.length; i++)
    if (overlay.kernels[i].std_dev == overlay.std_dev) {
      kernel = overlay.kernels[i];
      break;
    }

  // compute kernel

  if (!kernel) {
    kernel = { std_dev: overlay.std_dev };
    var half = 3 * kernel.std_dev; // 3*sigma coverage => less then 1% loss
    kernel.buffer = new Float32Array(new ArrayBuffer(4 * (1 + 2 * half)));
    var factor1 = 2 * Math.pow(kernel.std_dev, 2), factor2 = kernel.std_dev * Math.sqrt(2 * Math.PI);
    for (var x=0; x<kernel.buffer.length; x++)
      kernel.buffer[x] = Math.exp(-Math.pow(x-half, 2) / factor1) / factor2;
    overlay.kernels.push(kernel);
  }

  // compute density and rbg buffers, and paint

  if (overlay.mode == OVR_POP)
    compute_density(kernel);
  else if (overlay.mode == OVR_PAR)
    compute_partitions(kernel);

  paint();
}

function compute_partitions(kernel) {
  overlay.partitions = [];
  overlay.buffers = [];
  var offset = Math.floor(kernel.buffer.length / 2);
  var x, y, i, j, buffer, pos, town, part_val, x1, x2, dx, val;
  // progress stuff
  //var progress = 0, p1_full = 50, p1_step = Math.floor(data.towns.length / p1_full);
  //var p2_full = 50, p2_step = Math.floor(MAP_WIDTH / p1_full);
  //show_progress(0);
  // first pass (progress = 0)
  for (var i=0; i<data.towns.length; i++) {
    town = data.towns[i];
    part_val = (overlay.par_mode == OVR_PAR_RACES ? town.r : town.a);
    x1 = town.x1 - offset;
    x2 = x1 + kernel.buffer.length;
    dx = 0;
    if (x1 < 0) { dx = -x1; x1 = 0; }
    if (x2 >= MAP_WIDTH) x2 = MAP_WIDTH - 1;
    for (x=x1; x<x2; x++)
      add_density_value(kernel, part_val, town.y1 * MAP_WIDTH + x, x - x1 + dx, town.p, false);
    // progress stuff
    /*if (i && i % p1_step == 0) {
      progress = Math.floor((i / data.towns.length) * p1_full);
      show_progress(progress);
    }*/
  }
  // second pass (progress = 50)
  var b_len = overlay.buffers.length;
  var y1, y2, dy;
  for (y=0; y<MAP_WIDTH; y++) {
    for (x=0; x<MAP_WIDTH; x++) {
      pos = y * MAP_WIDTH + x;
      for (j=0; j<b_len; j++) {
        buffer = overlay.buffers[j];
        // ignore already generated output cells
        if (buffer.is_output[Math.floor(pos / 8)] & (1 << (pos % 8))) break;
        val = buffer.density[pos];
        if (!val) continue;
        part_val = overlay.partitions[buffer.partition[pos] - 1].value;
        y1 = y - offset;
        y2 = y1 + kernel.buffer.length;
        dy = 0;
        if (y1 < 0) { dy = - y1; y1 = 0; }
        if (y2 >= MAP_WIDTH) y2 = MAP_WIDTH - 1;
        for (i=y1; i<y2; i++)
          add_density_value(kernel, part_val, i * MAP_WIDTH + x, i - y1 + dy, val, true);
      }
    }
    /*if (y && y % p2_step == 0) {
      progress = p1_full + Math.floor((y / data.towns.length) * p2_full);
      show_progress(progress);
    }*/
  }
  // compute dominators
  var max_part_id, max_density, part_obj, found_one, is_one;
  overlay.dominators = new Uint8Array(new ArrayBuffer(MAP_WIDTH * MAP_WIDTH));
  for (y=0; y<MAP_WIDTH; y++)
    for (x=0; x<MAP_WIDTH; x++) {
      pos = y * MAP_WIDTH + x;
      max_part_id = 0; max_density = 0.1; found_one = false;
      for (i=0; i<overlay.buffers.length; i++) {
        buffer = overlay.buffers[i];
        is_one = (buffer.is_output[Math.floor(pos / 8)] & (1 << (pos % 8)) != 0);
        if (found_one && !is_one) break;
        if (is_one && buffer.density[pos] > max_density) {
          found_one = true;
          max_density = buffer.density[pos];
          max_part_id = buffer.partition[pos];
        }
      }
      if (!max_part_id) continue;
      overlay.dominators[pos] = max_part_id;
      // increment stats
      part_obj = overlay.partitions[max_part_id - 1];
      part_obj.area += 1;
      part_obj.pop += max_density;
    }
  // sort partitions
  overlay.partitions.sort(function(a, b) {
    return b.area - a.area;
  });
  overlay.buffers = []; // partition_ids broken due to sort; no longer needed anyway
  // rgb generation (progress = 100)
  var col;
  overlay.rgb = new Uint8Array(new ArrayBuffer(3 * MAP_WIDTH * MAP_WIDTH));
  for (i=0; i<overlay.dominators.length; i++) {
    max_part_id = overlay.dominators[i];
    if (max_part_id && max_part_id <= PAR_COLORS.length)
      col = PAR_COLORS[max_part_id - 1];
    else col = [0,0,0];
    overlay.rgb[i * 3] = col[0];
    overlay.rgb[i * 3 + 1] = col[1];
    overlay.rgb[i * 3 + 2] = col[2];
  }
}

function add_density_value(kernel, part_val, pos, kernel_pos, pop_val, is_output) {
  var part_id = 0, temp_id, i;
  var idx = Math.floor(pos / 8);
  var mask = 1 << (pos % 8);
  // find partition in partition table
  for (i=0;i<overlay.partitions.length;i++)
    if (overlay.partitions[i].value == part_val) {
      part_id = i + 1;
      break;
    }
  if (!part_id) {
    overlay.partitions.push({ value: part_val, name: part_val, pop: 0, area: 0 });
    part_id = overlay.partitions.length;
  }
  // find buffer
  var buffer = null;
  for (i=0;i<overlay.buffers.length;i++) {
    buffer = overlay.buffers[i];
    temp_id = buffer.partition[pos];
    if (!temp_id || (temp_id == part_id && (!is_output || buffer.is_output[idx] & mask))) {
      if (!temp_id) buffer.partition[pos] = part_id;
      break;
    }
    else buffer = null;
  }
  if (!buffer) buffer = add_overlay_buffer();
  // add to density
  buffer.density[pos] += pop_val * kernel.buffer[kernel_pos];
  if (is_output)
    buffer.is_output[idx] = buffer.is_output[idx] | mask;
}

function add_overlay_buffer() {
  var buffer = { partition: null, is_output: null, density: null }
  buffer.partition = new Uint8Array(new ArrayBuffer(MAP_WIDTH * MAP_WIDTH));
  buffer.is_output = new Uint8Array(new ArrayBuffer(Math.ceil(MAP_WIDTH * MAP_WIDTH / 8)));
  buffer.density = new Float32Array(new ArrayBuffer(4 * MAP_WIDTH * MAP_WIDTH));
  overlay.buffers.push(buffer);
  return buffer;
}

// applies a 1D gaussian kernel on both dimensions succesively

function compute_density(kernel) {
  overlay.density = new Float32Array(new ArrayBuffer(4 * MAP_WIDTH * MAP_WIDTH));
  var buffer = new Float32Array(new ArrayBuffer(4 * MAP_WIDTH * MAP_WIDTH));
  var offset = Math.floor(kernel.buffer.length / 2);
  for (var i=0; i<data.towns.length; i++) {
    var town = data.towns[i];
    if (overlay.race == "" || overlay.race == town.r) {
      var x1 = town.x1 - offset, x2 = x1 + kernel.buffer.length, dx = 0;
      if (x1 < 0) { dx = -x1; x1 = 0; }
      if (x2 >= MAP_WIDTH) x2 = MAP_WIDTH - 1;
      for (var x=x1; x<x2; x++)
        buffer[town.y1 * MAP_WIDTH + x] += town.p * kernel.buffer[x - x1 + dx];
    }
  }
  for (var y=0; y<MAP_WIDTH; y++)
    for (var x=0; x<MAP_WIDTH; x++) {
      var val = buffer[y * MAP_WIDTH + x];
      if (val) {
        var y1 = y - offset, y2 = y1 + kernel.buffer.length, dy = 0;
        if (y1 < 0) { dy = - y1; y1 = 0; }
        if (y2 >= MAP_WIDTH) y2 = MAP_WIDTH - 1;
        for (var i=y1;i<y2;i++)
          overlay.density[i * MAP_WIDTH + x] += val * kernel.buffer[i - y1 + dy];
      }
    }

    // compute max density (for normalization)

    overlay.max_density = 0;
    for (var i=0; i<overlay.density.length; i++)
      if (overlay.density[i] > overlay.max_density)
        overlay.max_density = overlay.density[i];

    // compute rgb buffer

    overlay.rgb = new Uint8Array(new ArrayBuffer(3 * MAP_WIDTH * MAP_WIDTH));
    for (var i=0; i<overlay.density.length; i++)
      val2rgb(overlay.density[i], overlay.max_density, i * 3);
}









// converts xml files from Illyriad (~17MB) to a more compact json (~1.3MB)
// xml files should be mannually downloaded from Illyriad and put into the data folder
// result is shown on the screen, to be manually copied into data/data.json
// this is to avoid the need for a dynamic back-end

function loadXml() {
  var al_loaded = false, to_loaded = false;
  var data = { server: "", date: "", alliances: [], towns: [] };

  var generateJson = function() {
    var div = $("#jsondiv");
    var json_text = JSON.stringify(data, null, 2);
    div.show();
    div.append(json_text);
  }

  $.ajax({
    type: "GET",
    url: ALLIANCES_XML,
    dataType: "xml",
    success: function(xml) {
      $(xml).find("alliances").children("alliance").each(function() {
        var a = {}, xml_a = $(this);
        a.id = parseInt(xml_a.children("alliance").attr("id"));
        a.name = xml_a.children("alliance").text();
        a.tck = xml_a.children("allianceticker").text();
        var mem = parseInt(xml_a.children("membercount").text());
        if (mem > 0) {
          a.NAP = [];
          a.conf = [];
          xml_a.find("relationship").each(function () {
            var xml_rel = $(this);
            var t = xml_rel.children("relationshiptype").text();
            var al_id = xml_rel.children("proposedbyalliance").attr("id");
            if (al_id == a.id) al_id = xml_rel.children("acceptedbyalliance").attr("id");
            if (t == "NAP") a.NAP.push(parseInt(al_id));
            else if (t == "Confederation") a.conf.push(parseInt(al_id));
          });
          data.alliances.push(a);
        }
      });
      al_loaded = true;
      if (to_loaded) generateJson();
    }
  });

  $.ajax({
    type: "GET",
    url: TOWNS_XML,
    dataType: "xml",
    success: function(xml) {
      var server = $(xml).children("towns").children("server");
      data.server = server.children("name").text();
      data.date = server.children("datagenerationdatetime").text();
      $(xml).children("towns").children("town").each(function() {
        var t = {}, xml_t = $(this);
        var loc = xml_t.children("location"), pl = xml_t.children("player"), dat = xml_t.children("towndata");
        t.p = parseInt(dat.children("population").text());
        if (dat.children("isalliancecapitalcity").text() == "1") {
          t.c = 1;
          t.pl = pl.children("playername").text();
          t.name = dat.children("townname").text();
        }
        t.x = parseInt(loc.children("mapx").text());
        t.y = parseInt(loc.children("mapy").text());
        var alliance = parseInt(pl.children("playeralliance").children("alliancename").attr("id"));
        if (alliance) t.a = alliance;
        var race = pl.children("playerrace").text().substring(0, 1);
        if (race != "H") t.r = race;
        if (t.p > 0) data.towns.push(t);
      });
      to_loaded = true;
      if (al_loaded) generateJson();
    }
  });
}






// utils *******************************************************************

// converts scalar to light wavelength and then to to rgb; paints it on the rgb buffer
// algorithm snached from http://www.efg2.com/Lab/ScienceAndEngineering/Spectra.htm

var gamma = 0.8;

function val2rgb(val, max_val, idx) {
  var factor = 0, r = 0, g = 0, b = 0;
  var wavelen = 380 + 400 * val / max_val;
  if (wavelen >= 380 && wavelen < 440) { r = -(wavelen - 440) / 60; b = 1; }
  else if (wavelen < 490) { g = (wavelen - 440) / 50; b = 1; }
  else if (wavelen < 510) { g = 1; b = -(wavelen - 510) / 20; }
  else if (wavelen < 580) { r = (wavelen - 510) / 70; g = 1; }
  else if (wavelen < 645) { r = 1; g = -(wavelen - 645) / 65; }
  else if (wavelen < 780) r = 1;
  if (wavelen >= 380 && wavelen < 420)
    factor = 0.3 + 0.7 * (wavelen - 380) / 40;
  else if (wavelen < 700)
    factor = 1;
  else if (wavelen < 780)
    factor = 0.3 + 0.7 * (780 - wavelen) / 80;
  if (r) overlay.rgb[idx] = Math.round(255 * Math.pow(r * factor, gamma));
  if (g) overlay.rgb[idx + 1] = Math.round(255 * Math.pow(g * factor, gamma));
  if (b) overlay.rgb[idx + 2] = Math.round(255 * Math.pow(b * factor, gamma));
}

function show_progress(percent) {
  var ctx = $("#map")[0].getContext("2d");
  var w = 150, h = 50;
  var x = Math.floor((MAP_WIDTH - w) / 2), y = Math.floor((MAP_WIDTH - h) / 2);
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.fillStyle = "blue";
  ctx.fill();
  ctx.fillStyle = "white";
  ctx.font = "40px Calibri";
  ctx.fillText(percent + "%", x + 40, y + 38);
}
