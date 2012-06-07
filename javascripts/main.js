"use strict";

var TOWNS_XML = "data/datafile_towns.xml";
var ALLIANCES_XML = "data/datafile_alliances.xml";
var DATA_JSON = "data/data.json";
var BG_IMAGE = "images/region_faction_map.png";
var STAR_IMAGE = "images/star.gif";
var ILLY_MAP_URL = "http://elgea.illyriad.co.uk/#/World/Map/{x}/{y}/10";

var MAP_WIDTH = 1000;
var OVR_NONE = "none", OVR_POP = "pop", OVR_PAR = "par";        // overlay modes: none, population density in false colors, or map partition
var OVR_PAR_RACES = "races", OVER_PAR_ALLIANCES = "alliances",
  OVER_PAR_CONFEDS = "confeds";                                 // submodes for partition mode
var PAR_COLORS = [ [0xFF,0,0]/*red*/, [0,0xFF,0]/*lime*/, [0,0,0xFF]/*blue*/, [0xFF,0xFF,0]/*yellow*/, [0,0xFF,0xFF]/*cyan*/,
  [0xFF,0,0xFF]/*fuchsia*/, [0xFF,0xA5,0]/*orange*/, [0,0x80,0]/*green*/, [0x80,0x80,0]/*olive*/, [0,0,0xA0]/*darkblue*/,
  [0xA5,0x2A,0x2A]/*brown*/, [0x80,0,0x80]/*purple*/, [0xAD,0xD8,0xE6]/*lightblue*/, [0x80,0,0]/*maroon*/, [0xC0,0xC0,0xC0]/*silver*/ ];
var KERNEL_UNIFORM_SIZE = 300;

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
  race: -1,        // IN: race filter code (-1 = no filter)
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

var gl;
var shaders = { main: null, gauss: null }
var mvMatrix = mat4.create(), pMatrix = mat4.create();
var buffers = {
  mapPos: null,
  mapTexPos: null,
  starsPos: null,
  starsTexPos: null,
  selStarPos: null,
  selStarTexPos: null
};
var textures = {
  bg_map: null,
  star: null,
  towns: null,
  overlay_0: null,
  overlay_1: null,
  overlay_2: null,
}
var fbs = {
  overlay_0: null,
  overlay_1: null,
  overlay_2: null,
}






// initialization ******************************************************************

$(document).ready(function () {
  if (!init_webgl()) return;
  var bg_loaded = false, star_loaded = false, data_loaded = false;
  textures.bg_map.image.onload = function() {
    gl.bindTexture(gl.TEXTURE_2D, textures.bg_map);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, textures.bg_map.image);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    bg_loaded = true;
    if (data_loaded && star_loaded) init_data();
  };
  textures.star.image.onload = function() {
    gl.bindTexture(gl.TEXTURE_2D, textures.star);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, textures.star.image);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.bindTexture(gl.TEXTURE_2D, null);
    star_loaded = true;
    if (data_loaded && bg_loaded) init_data();
  };
  $("#show_map").change(draw);
  $("#show_towns").change(draw);
  $("#show_capitals").change(draw);
  $("#overlay_mode").change(recompute_overlay);
  $("#std_dev").change(recompute_overlay);
  $("#xml2json_btn").click(loadXml);
  $("#map").mousemove(map_mousemove);
  $("#map").dblclick(map_dblclick);
  textures.bg_map.image.src = BG_IMAGE;
  textures.star.image.src = STAR_IMAGE;
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
    town.y1 = Math.round((town.y + MAP_WIDTH) / 2);
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
  init_kernels();
  init_data_buffers();
  init_towns_tex();
  draw();
}

function init_kernels() {
  $("#std_dev option").each(function() {
    var kernel = { std_dev: $(this).val() };
    var half = 3 * kernel.std_dev; // 3*sigma coverage => less then 1% loss
    kernel.buffer = new Float32Array(new ArrayBuffer(4 * (1 + 2 * half)));
    var factor1 = 2 * Math.pow(kernel.std_dev, 2), factor2 = kernel.std_dev * Math.sqrt(2 * Math.PI);
    for (var x=0; x<kernel.buffer.length; x++)
      kernel.buffer[x] = Math.exp(-Math.pow(x-half, 2) / factor1) / factor2;
    overlay.kernels.push(kernel);
  });
}

function init_webgl() {
  var canvas = $("#map")[0], err = "";
  try {
    gl = canvas.getContext("experimental-webgl", { preserveDrawingBuffer: true });
    gl.viewportWidth = canvas.width;
    gl.viewportHeight = canvas.height;
  }
  catch (e) {
    err = "\n" + e;
  }
  if (!gl) {
    alert("Could not initialise WebGL, sorry :-(" + err);
    return false;
  }
  else {
    if (!init_shaders()) return false;
    init_static_buffers();
    textures.bg_map = gl.createTexture();
    textures.bg_map.image = new Image();
    textures.star = gl.createTexture();
    textures.star.image = new Image();
    init_overlay_fb_tex();
    gl.clearColor(0.0, 0.0, 0.0, 1.0);
    return true;
  }
}

function init_shaders() {
  shaders.main = create_program("main_shader-fs", "main_shader-vs");
  if (!shaders.main) return false;
  shaders.main.uMapSampler = gl.getUniformLocation(shaders.main, "uMapSampler");
  shaders.main.uOverlaySampler = gl.getUniformLocation(shaders.main, "uOverlaySampler");
  shaders.main.uStarSampler = gl.getUniformLocation(shaders.main, "uStarSampler");
  shaders.main.uTownsSampler = gl.getUniformLocation(shaders.main, "uTownsSampler");
  shaders.main.uShowBg = gl.getUniformLocation(shaders.main, "uShowBg");
  shaders.main.uGreyBg = gl.getUniformLocation(shaders.main, "uGreyBg");
  shaders.main.uShowTowns = gl.getUniformLocation(shaders.main, "uShowTowns");
  shaders.main.uShowOverlay = gl.getUniformLocation(shaders.main, "uShowOverlay");
  shaders.main.uStarColor = gl.getUniformLocation(shaders.main, "uStarColor");
  shaders.main.uStars = gl.getUniformLocation(shaders.main, "uStars");
  shaders.gauss = create_program("gauss-fs", "main_shader-vs");
  if (!shaders.gauss) return false;
  shaders.gauss.uTownsSampler = gl.getUniformLocation(shaders.gauss, "uTownsSampler");
  shaders.gauss.uOvr0Sampler = gl.getUniformLocation(shaders.gauss, "uOvr0Sampler");
  shaders.gauss.uKernel = [];
  for (var i=0; i<KERNEL_UNIFORM_SIZE; i++)
    shaders.gauss.uKernel.push(gl.getUniformLocation(shaders.gauss, "uKernel[" + i + "]"));
  shaders.gauss.uKernelSize = gl.getUniformLocation(shaders.gauss, "uKernelSize");
  shaders.gauss.uRace = gl.getUniformLocation(shaders.gauss, "uRace");
  shaders.gauss.uPass = gl.getUniformLocation(shaders.gauss, "uPass");
  shaders.gauss.uNormFactor = gl.getUniformLocation(shaders.gauss, "uNormFactor");
  return true;
}

function create_program(vs_script_id, fs_script_id) {
  var fragment_shader = get_shader(gl, fs_script_id);
  var vertex_shader = get_shader(gl, vs_script_id);
  var program = gl.createProgram();
  gl.attachShader(program, vertex_shader);
  gl.attachShader(program, fragment_shader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    alert("Could not initialise shaders.");
    return null;
  }
  program.aVertexPosition = gl.getAttribLocation(program, "aVertexPosition");
  gl.enableVertexAttribArray(program.aVertexPosition);
  program.aTextureCoord = gl.getAttribLocation(program, "aTextureCoord");
  gl.enableVertexAttribArray(program.aTextureCoord);
  program.uPMatrix = gl.getUniformLocation(program, "uPMatrix");
  program.uMVMatrix = gl.getUniformLocation(program, "uMVMatrix");
  return program;
}

function init_overlay_fb_tex() {
  var attach_tex = function(size) {
    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return tex;
  };

  fbs.overlay_0 = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbs.overlay_0);
  textures.overlay_0 = attach_tex(MAP_WIDTH / 10);

  fbs.overlay_1 = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbs.overlay_1);
  textures.overlay_1 = attach_tex(MAP_WIDTH);

  fbs.overlay_2 = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbs.overlay_2);
  textures.overlay_2 = attach_tex(MAP_WIDTH);

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);
}

function init_static_buffers() {
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

  buffers.maxPos = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.maxPos);
  vertices = [
       0.0, 0.0,  0.0,
       MAP_WIDTH / 10,  0.0,  0.0,
       0.0,  MAP_WIDTH / 10,  0.0,
       MAP_WIDTH / 10,  MAP_WIDTH / 10,  0.0
  ];
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
  buffers.maxPos.itemSize = 3;
  buffers.maxPos.numItems = 4;

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
  var x = town.x1 - r, y = town.y1 - r;
  return { x: x, y: y, scale: 2 * r }
}

function init_data_buffers() {
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
      vertices.push(vtx_pos[j] * pos.scale + pos.x);
      vertices.push(vtx_pos[j + 1] * pos.scale + pos.y);
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

function init_towns_tex() {
  var buffer = new Uint8Array(new ArrayBuffer(MAP_WIDTH * MAP_WIDTH * 16));
  var max_pop = 0;
  for (var i=0; i<data.towns.length; i++)
    if (data.towns[i].p > max_pop)
      max_pop = data.towns[i].p;
  var factor = 65536 / max_pop;
  for (var i=0; i<data.towns.length; i++) {
    var town = data.towns[i];
    var idx = (town.x + MAP_WIDTH + ((town.y + MAP_WIDTH) * MAP_WIDTH * 2)) * 4;
    var p = Math.floor(town.p * factor);
    buffer[idx] = Math.floor(p / 256);
    buffer[idx + 1] = p % 256;
    buffer[idx + 2] = 0; // alliance index
    buffer[idx + 3] = get_race_code(town.r);
  }
  textures.towns = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, textures.towns);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 2 * MAP_WIDTH, 2 * MAP_WIDTH, 0, gl.RGBA, gl.UNSIGNED_BYTE, buffer);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindTexture(gl.TEXTURE_2D, null);
}







// draw ************************************************************************

function draw() {
  var v_map = $("#show_map").is(':checked');
  var v_tow = $("#show_towns").is(':checked');
  var v_cap = $("#show_capitals").is(':checked');

  gl.useProgram(shaders.main);
  gl.viewport(0, 0, gl.viewportWidth, gl.viewportHeight);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
  gl.enable(gl.BLEND);
  //gl.disable(gl.DEPTH_TEST);

  mat4.ortho(0, MAP_WIDTH, 0, MAP_WIDTH, 0, 10, pMatrix);
  gl.uniformMatrix4fv(shaders.main.uPMatrix, false, pMatrix);

  // draw background map and/or overlay

  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, textures.towns);
  gl.uniform1i(shaders.main.uTownsSampler, 2);

  gl.uniform1i(shaders.main.uShowBg, v_map);
  gl.uniform1i(shaders.main.uShowTowns, v_tow);
  gl.uniform1i(shaders.main.uShowOverlay, overlay.mode != OVR_NONE);

  if (v_map || v_tow || overlay.mode != OVR_NONE) {
    mat4.identity(mvMatrix);
    mat4.translate(mvMatrix, [0.0, 0.0, -5.0]);
    if (overlay.mode != OVR_NONE) {
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, textures.overlay_2);
      gl.uniform1i(shaders.main.uOverlaySampler, 3);
    }
    draw_map(v_map, v_cap || v_tow || overlay.mode != OVR_NONE);
  }

  // draw capitals

  if (v_cap) {
    mat4.identity(mvMatrix);
    draw_stars(buffers.starsPos, buffers.starsTexPos, { r: 232, g: 222, b: 49 });
    if (map_state.sel_cap) {
      var pos = get_town_pos(map_state.sel_cap, true);
      mat4.identity(mvMatrix);
      mat4.translate(mvMatrix, [pos.x, pos.y, -1.0]);
      mat4.scale(mvMatrix, [pos.scale, pos.scale, 1.0]);
      draw_stars(buffers.selStarPos, buffers.selStarTexPos, { r: 0, g: 255, b: 0 });
    }
  }
}

function draw_overlay() {
  mat4.ortho(0, MAP_WIDTH, 0, MAP_WIDTH, 0, 10, pMatrix);
  mat4.identity(mvMatrix);
  mat4.translate(mvMatrix, [0.0, 0.0, -4.0]);

  // global initialization

  gl.useProgram(shaders.gauss);

  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, textures.towns);
  gl.uniform1i(shaders.gauss.uTownsSampler, 2);
  gl.activeTexture(gl.TEXTURE4);
  gl.bindTexture(gl.TEXTURE_2D, textures.overlay_1);
  gl.uniform1i(shaders.gauss.uOvr0Sampler, 4);

  gl.uniform1i(shaders.gauss.uRace, overlay.race);
  gl.uniformMatrix4fv(shaders.gauss.uPMatrix, false, pMatrix);
  gl.uniformMatrix4fv(shaders.gauss.uMVMatrix, false, mvMatrix);
  gl.uniform1f(shaders.gauss.uNormFactor, 1.0);
  var kernel = null;
  for (var i=0; i<overlay.kernels.length; i++)
    if (overlay.kernels[i].std_dev == overlay.std_dev) {
      kernel = overlay.kernels[i].buffer;
      break;
    }
  gl.uniform1i(shaders.gauss.uKernelSize, kernel.length);
  for (var i=0; i<kernel.length && i<KERNEL_UNIFORM_SIZE; i++)
    gl.uniform1f(shaders.gauss.uKernel[i], kernel[i]);

  // passes

  var overlay_pass = function(pass, fb, get_max_pass) {
    var vtx_buffer = (get_max_pass ? buffers.maxPos : buffers.mapPos);
    gl.uniform1i(shaders.gauss.uPass, pass);
    if (get_max_pass) gl.uniform1f(shaders.gauss.uNormFactor, 1.0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.bindBuffer(gl.ARRAY_BUFFER, vtx_buffer);
    gl.vertexAttribPointer(shaders.gauss.aVertexPosition, vtx_buffer.itemSize, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.mapTexPos);
    gl.vertexAttribPointer(shaders.gauss.aTextureCoord, buffers.mapTexPos.itemSize, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, vtx_buffer.numItems);
    if (get_max_pass) {
      var pixels = new Uint8Array(4 * MAP_WIDTH * MAP_WIDTH / 100);
      gl.readPixels(0, 0, MAP_WIDTH / 10, MAP_WIDTH / 10, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      var max_val = 0;
      for (var i=0; i<pixels.length; i+=4) {
        var val = pixels[i] * 256 + pixels[i + 1];
        if (val > max_val)
          max_val = val;
      }
      gl.uniform1f(shaders.gauss.uNormFactor, 65536 / max_val);
    }
  };

  overlay_pass(0, fbs.overlay_0, true);
  overlay_pass(1, fbs.overlay_1, false);

  overlay_pass(2, fbs.overlay_0, true);
  overlay_pass(3, fbs.overlay_2, false);

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  draw();
}

function draw_map(v_map, grayed) {
  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.mapTexPos);
  gl.vertexAttribPointer(shaders.main.aTextureCoord, buffers.mapTexPos.itemSize, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.mapPos);
  gl.vertexAttribPointer(shaders.main.aVertexPosition, buffers.mapPos.itemSize, gl.FLOAT, false, 0, 0);

  if (v_map) {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, textures.bg_map);
    gl.uniform1i(shaders.main.uMapSampler, 0);
  }

  gl.uniformMatrix4fv(shaders.main.uMVMatrix, false, mvMatrix);
  gl.uniform1i(shaders.main.uGreyBg, grayed);
  gl.uniform1i(shaders.main.uStars, false);

  gl.drawArrays(gl.TRIANGLE_STRIP, 0, buffers.mapPos.numItems);
}

function draw_stars(vtx_buffer, tex_buffer, color) {
  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.starsTexPos);
  gl.vertexAttribPointer(shaders.main.aTextureCoord, buffers.starsTexPos.itemSize, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, vtx_buffer);
  gl.vertexAttribPointer(shaders.main.aVertexPosition, vtx_buffer.itemSize, gl.FLOAT, false, 0, 0);

  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, textures.star);

  gl.uniform1i(shaders.main.uStarSampler, 1);
  gl.uniform1i(shaders.main.uStars, true);
  gl.uniform3f(shaders.main.uStarColor, color.r / 255, color.g / 255, color.b / 255);
  gl.uniformMatrix4fv(shaders.main.uMVMatrix, false, mvMatrix);

  gl.drawArrays(gl.TRIANGLES, 0, tex_buffer.numItems);
}






// control *********************************************************************

function map_mousemove(event) {
  var old_sel_cap = map_state.sel_cap;
  map_state.sel_cap = null;
  map_state.mx = event.pageX - this.offsetLeft;
  map_state.my = MAP_WIDTH - event.pageY + this.offsetTop;
  $("#pos_info").html("[ " + (map_state.mx * 2 - MAP_WIDTH) + " : " + (map_state.my * 2 - MAP_WIDTH) + " ]");
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
        "capital of <strong>" + map_state.sel_cap.alliance + "</strong><br />" +
        "population " + map_state.sel_cap.p);
      var pos = $("#map").position();
      $("#infobox").css({
          position: "absolute",
          top: (pos.top + MAP_WIDTH - town.y1 - 60) + "px",
          left: (pos.left + town.x1 + 15) + "px"
      }).show();
    }
    draw();
  }
}

function map_dblclick(event) {
  var x = (event.pageX - this.offsetLeft) * 2 - MAP_WIDTH;
  var y = MAP_WIDTH - (event.pageY - this.offsetTop) * 2;
  window.open(ILLY_MAP_URL.replace("{x}", x).replace("{y}", y), '_blank');
}




// compute


function recompute_overlay() {
  overlay.std_dev = parseInt($("#std_dev").val());
  overlay.mode = $("#overlay_mode").val();
  if (overlay.mode.indexOf(OVR_POP) == 0) {
    overlay.race = get_race_code(overlay.mode.substring(OVR_POP.length + 1));
    overlay.mode = OVR_POP;
  }
  else if (overlay.mode.indexOf(OVR_PAR) == 0) {
    overlay.par_mode = overlay.mode.substring(OVR_PAR.length + 1);
    overlay.mode = OVR_PAR;
  }

  // compute density and rbg buffers, and draw

  /*if (overlay.mode == OVR_POP)
    compute_density(kernel);
  else if (overlay.mode == OVR_PAR)
    compute_partitions(kernel);*/

  if (overlay.mode != OVR_NONE) draw_overlay();
  else draw();
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

// converts scalar to light wavelength and then to to rgb; draws it on the rgb buffer
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

function get_shader(gl, id) {
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

function get_race_code(race_str) {
  var r = -1;
  if (race_str == "E") r = 0;
  else if (race_str == "H") r = 1;
  else if (race_str == "D") r = 2;
  else if (race_str == "O") r = 3;
  return r;
}
