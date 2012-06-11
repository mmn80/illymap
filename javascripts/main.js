"use strict";

var TOWNS_XML = "data/datafile_towns.xml";
var ALLIANCES_XML = "data/datafile_alliances.xml";
var DATA_JSON = "data/data.json";
var BG_IMAGE = "images/region_faction_map.png";
var STAR_IMAGE = "images/star.gif";
var ILLY_MAP_URL = "http://elgea.illyriad.co.uk/#/World/Map/{x}/{y}/10";

var MAP_WIDTH = 1000;
var OVR_NONE = "none", OVR_POP = "pop", OVR_PAR = "par";        // overlay modes: none, population density in false colors, or map partition
var OVR_PAR_RACES = "races", OVR_PAR_ALLIANCES = "alliances",
  OVR_PAR_CONFEDS = "confeds";                                 // submodes for partition mode
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
  gamma: 0.8,
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
var shaders = {
  main: null,
  gauss: null,
  part: null
}
var mvMatrix = mat4.create(), pMatrix = mat4.create();
var buffers = {
  mapPos: null,
  maxPos: null,
  partIdxPos: null,
  partTempPos: null,
  texPos: null,
  starsPos: null,
  starsTexPos: null,
  selStarPos: null,
  selStarTexPos: null
};
var textures = {
  bg_map: null,
  star: null,
  towns: null,
  overlay_max: null,
  overlay_temp1: null,
  overlay_out: null,
  part_idx: null,
  part_temp: null
}
var fbs = {
  overlay_max: null,   // 100x100
  overlay_temp1: null, // 1000x1000
  overlay_temp2: null, // 1000x1000
  overlay_out: null,   // 1000x1000
  part_idx: null,      // 3000x3000 - 4 idx per fragmanet; 6x6=36 buffers/tiles
  part_temp: null      // 6000x3000 - 2 gauss sums per fragment
}






// initialization ******************************************************************

$(document).ready(function () {
  $("#pos_info").hide();
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
  $("#gamma").change(recompute_overlay);
  $("#xml2json_btn").click(loadXml);
  $("#map").mousemove(map_mousemove);
  $("#map").mouseout(map_mouseout);
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
  if (data.alliances.length > 254)
    alert("Warning!\nThere are more then 254 alliances. Alliance partition computations will only consider the first 254 (less GPU memory needed). Other overlays are not affected.");
  for (var i=0; i<data.towns.length; i++) {
    var town = data.towns[i];
    town.x1 = Math.round((town.x + MAP_WIDTH) / 2);
    town.y1 = Math.round((town.y + MAP_WIDTH) / 2);
    if (town.r === undefined)
      town.r = "H";
    town.alliance_index = 0;
    if (town.a > 0)
      for (var j=0; j<data.alliances.length; j++)
        if (data.alliances[j].id == town.a) {
          if (j < 255) town.alliance_index = j + 1;  // 1-based index; 0 = no alliance
          break;
        }
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
  if ($("#overlay_mode").val() != OVR_NONE)
    recompute_overlay();
  else draw();
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
  shaders.gauss.uOvr1Sampler = gl.getUniformLocation(shaders.gauss, "uOvr1Sampler");
  shaders.gauss.uKernel = [];
  for (var i=0; i<KERNEL_UNIFORM_SIZE; i++)
    shaders.gauss.uKernel.push(gl.getUniformLocation(shaders.gauss, "uKernel[" + i + "]"));
  shaders.gauss.uKernelSize = gl.getUniformLocation(shaders.gauss, "uKernelSize");
  shaders.gauss.uRace = gl.getUniformLocation(shaders.gauss, "uRace");
  shaders.gauss.uPass = gl.getUniformLocation(shaders.gauss, "uPass");
  shaders.gauss.uMaxValue = gl.getUniformLocation(shaders.gauss, "uMaxValue");
  shaders.gauss.uGamma = gl.getUniformLocation(shaders.gauss, "uGamma");
  shaders.part = create_program("partition-fs", "main_shader-vs");
  if (!shaders.part) return false;
  shaders.part.uTownsSampler = gl.getUniformLocation(shaders.part, "uTownsSampler");
  shaders.part.uIdxSampler = gl.getUniformLocation(shaders.part, "uIdxSampler");
  shaders.part.uTempSampler = gl.getUniformLocation(shaders.part, "uTempSampler");
  shaders.part.uKernel = [];
  for (var i=0; i<KERNEL_UNIFORM_SIZE; i++)
    shaders.part.uKernel.push(gl.getUniformLocation(shaders.part, "uKernel[" + i + "]"));
  shaders.part.uKernelSize = gl.getUniformLocation(shaders.part, "uKernelSize");
  shaders.part.uPass = gl.getUniformLocation(shaders.part, "uPass");
  shaders.part.uPartMode = gl.getUniformLocation(shaders.part, "uPartMode");
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

function attach_tex_to_fb(width, height) {
  var tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  return tex;
}

function init_overlay_fb_tex() {
  fbs.overlay_max = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbs.overlay_max);
  textures.overlay_max = attach_tex_to_fb(MAP_WIDTH / 10, MAP_WIDTH / 10);

  fbs.overlay_temp1 = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbs.overlay_temp1);
  textures.overlay_temp1 = attach_tex_to_fb(MAP_WIDTH, MAP_WIDTH);

  fbs.overlay_temp2 = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbs.overlay_temp2);
  textures.overlay_temp2 = attach_tex_to_fb(MAP_WIDTH, MAP_WIDTH);

  fbs.overlay_out = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbs.overlay_out);
  textures.overlay_out = attach_tex_to_fb(MAP_WIDTH, MAP_WIDTH);

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);
}

function init_part_fb_tex() {
  if (fbs.part_idx) return;

  fbs.part_idx = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbs.part_idx);
  textures.part_idx = attach_tex_to_fb(MAP_WIDTH * 3, MAP_WIDTH * 3);  // 4 ids per fragment

  fbs.part_temp = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbs.part_temp);
  textures.part_temp = attach_tex_to_fb(MAP_WIDTH * 6, MAP_WIDTH * 3); // 2 halfs per fragment

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);
}

function init_static_buffers() {
  var create_quad = function(width, height) {
    var buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    var vertices = [
         0.0,   0.0,    0.0,
         width, 0.0,    0.0,
         0.0,   height, 0.0,
         width, height, 0.0
    ];
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
    buffer.itemSize = 3;
    buffer.numItems = 4;
    return buffer;
  };

  buffers.mapPos = create_quad(MAP_WIDTH, MAP_WIDTH);
  buffers.maxPos = create_quad(MAP_WIDTH / 10, MAP_WIDTH / 10);
  buffers.partIdxPos = create_quad(MAP_WIDTH * 3, MAP_WIDTH * 3);
  buffers.partTempPos = create_quad(MAP_WIDTH * 6, MAP_WIDTH * 3);

  buffers.texPos = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.texPos);
  var textureCoords = [
      0.0, 0.0,
      1.0, 0.0,
      0.0, 1.0,
      1.0, 1.0
  ];
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(textureCoords), gl.STATIC_DRAW);
  buffers.texPos.itemSize = 2;
  buffers.texPos.numItems = 4;
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
  for (var i=0; i<data.towns.length; i++) {
    var town = data.towns[i];
    var idx = (town.x + MAP_WIDTH + ((town.y + MAP_WIDTH) * MAP_WIDTH * 2)) * 4;
    var half = float2half(town.p);
    buffer[idx] = half[0];
    buffer[idx + 1] = half[1];
    buffer[idx + 2] = town.alliance_index;
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
      gl.bindTexture(gl.TEXTURE_2D, textures.overlay_out);
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

function upload_kernel(shader) {
  var kernel = null;
  for (var i=0; i<overlay.kernels.length; i++)
    if (overlay.kernels[i].std_dev == overlay.std_dev) {
      kernel = overlay.kernels[i].buffer;
      break;
    }
  gl.uniform1i(shader.uKernelSize, kernel.length);
  for (var i=0; i<kernel.length && i<KERNEL_UNIFORM_SIZE; i++)
    gl.uniform1f(shader.uKernel[i], kernel[i]);
}

function overlay_pass(shader, pass, fb, vtx_buffer, width, height, get_max_pass) {
  gl.uniform1i(shader.uPass, pass);
  if (get_max_pass) gl.uniform1f(shader.uMaxValue, 1.0);
  mat4.ortho(0, width, 0, height, 0, 10, pMatrix);
  gl.uniformMatrix4fv(shader.uPMatrix, false, pMatrix);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.bindBuffer(gl.ARRAY_BUFFER, vtx_buffer);
  gl.vertexAttribPointer(shader.aVertexPosition, vtx_buffer.itemSize, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.texPos);
  gl.vertexAttribPointer(shader.aTextureCoord, buffers.texPos.itemSize, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, vtx_buffer.numItems);
  if (get_max_pass) {
    var pixels = new Uint8Array(4 * MAP_WIDTH * MAP_WIDTH / 100);
    gl.readPixels(0, 0, MAP_WIDTH / 10, MAP_WIDTH / 10, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    var max_val = 0;
    for (var i=0; i<pixels.length; i+=4) {
      var val = half2float(pixels[i], pixels[i + 1]);
      if (val > max_val)
        max_val = val;
    }
    gl.uniform1f(shader.uMaxValue, max_val);
  }
}

function draw_heat() {
  gl.useProgram(shaders.gauss);

  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, textures.towns);
  gl.uniform1i(shaders.gauss.uTownsSampler, 2);
  gl.activeTexture(gl.TEXTURE4);
  gl.bindTexture(gl.TEXTURE_2D, textures.overlay_temp1);
  gl.uniform1i(shaders.gauss.uOvr0Sampler, 4);
  gl.activeTexture(gl.TEXTURE5);
  gl.bindTexture(gl.TEXTURE_2D, textures.overlay_temp2);
  gl.uniform1i(shaders.gauss.uOvr1Sampler, 5);

  mat4.identity(mvMatrix);
  mat4.translate(mvMatrix, [0.0, 0.0, -4.0]);
  gl.uniformMatrix4fv(shaders.gauss.uMVMatrix, false, mvMatrix);

  gl.uniform1i(shaders.gauss.uRace, overlay.race);
  gl.uniform1f(shaders.gauss.uGamma, overlay.gamma);
  gl.uniform1f(shaders.gauss.uMaxValue, 0.0);
  upload_kernel(shaders.gauss);

  overlay_pass(shaders.gauss, 0, fbs.overlay_temp1, buffers.mapPos, MAP_WIDTH, MAP_WIDTH, false);
  overlay_pass(shaders.gauss, 1, fbs.overlay_temp2, buffers.mapPos, MAP_WIDTH, MAP_WIDTH, false);
  overlay_pass(shaders.gauss, 2, fbs.overlay_max, buffers.maxPos, MAP_WIDTH, MAP_WIDTH, true);
  overlay_pass(shaders.gauss, 3, fbs.overlay_out, buffers.mapPos, MAP_WIDTH, MAP_WIDTH, false);

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  draw();
}

function draw_partition() {
  gl.useProgram(shaders.part);

  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, textures.towns);
  gl.uniform1i(shaders.part.uTownsSampler, 2);
  gl.activeTexture(gl.TEXTURE6);
  gl.bindTexture(gl.TEXTURE_2D, textures.part_idx);
  gl.uniform1i(shaders.part.uIdxSampler, 6);
  gl.activeTexture(gl.TEXTURE7);
  gl.bindTexture(gl.TEXTURE_2D, textures.part_temp);
  gl.uniform1i(shaders.part.uTempSampler, 7);

  mat4.identity(mvMatrix);
  mat4.translate(mvMatrix, [0.0, 0.0, -4.0]);
  gl.uniformMatrix4fv(shaders.part.uMVMatrix, false, mvMatrix);
  upload_kernel(shaders.part);
  gl.uniform1i(shaders.part.uPartMode, get_par_mode_code());

  overlay_pass(shaders.part, 0, fbs.part_idx, buffers.partIdxPos, MAP_WIDTH * 3, MAP_WIDTH * 3, false);
  overlay_pass(shaders.part, 1, fbs.part_temp, buffers.partTempPos, MAP_WIDTH * 6, MAP_WIDTH * 3, false);
  overlay_pass(shaders.part, 2, fbs.overlay_out, buffers.mapPos, MAP_WIDTH, MAP_WIDTH, false);

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  draw();
}

function draw_map(v_map, grayed) {
  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.texPos);
  gl.vertexAttribPointer(shaders.main.aTextureCoord, buffers.texPos.itemSize, gl.FLOAT, false, 0, 0);

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
  var off = $("#map").offset();
  map_state.mx = event.pageX - off.left;
  map_state.my = MAP_WIDTH - event.pageY + off.top;
  map_state.illy_x = map_state.mx * 2 - MAP_WIDTH;
  map_state.illy_y = map_state.my * 2 - MAP_WIDTH;
  var illyx = map_state.illy_x.toString(), illyy = map_state.illy_y.toString();
  while (illyx.length < 4) illyx = " " + illyx;
  while (illyy.length < 4) illyy = " " + illyy;
  illyx = illyx.replace(/ /g, "&nbsp;");
  illyy = illyy.replace(/ /g, "&nbsp;");
  $("#pos_info").html("[" + illyx + ":" + illyy + "]");
  $("#pos_info").show();
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

function map_mouseout(event) {
  $("#pos_info").hide();
}

function map_dblclick(event) {
  var x = (event.pageX - this.offsetLeft) * 2 - MAP_WIDTH;
  var y = MAP_WIDTH - (event.pageY - this.offsetTop) * 2;
  window.open(ILLY_MAP_URL.replace("{x}", x).replace("{y}", y), '_blank');
}

function recompute_overlay() {
  overlay.std_dev = parseInt($("#std_dev").val());
  overlay.mode = $("#overlay_mode").val();
  overlay.gamma = parseFloat($("#gamma").val());
  if (overlay.mode.indexOf(OVR_POP) == 0) {
    overlay.race = get_race_code(overlay.mode.substring(OVR_POP.length + 1));
    overlay.mode = OVR_POP;
  }
  else if (overlay.mode.indexOf(OVR_PAR) == 0) {
    overlay.par_mode = overlay.mode.substring(OVR_PAR.length + 1);
    overlay.mode = OVR_PAR;
    init_part_fb_tex();
  }
  if (overlay.mode == OVR_POP) draw_heat();
  else if (overlay.mode == OVR_PAR) draw_partition();
  else draw();
}

// converts xml files from Illyriad (~17MB) to a more compact json (~1.3MB)
// xml files should be manually downloaded from Illyriad and put into the data folder
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

function get_par_mode_code() {
  if (overlay.par_mode == OVR_PAR_RACES) return 0;
  else if (overlay.par_mode == OVR_PAR_ALLIANCES) return 1;
  else if (overlay.par_mode == OVR_PAR_CONFEDS) return 2;
}

function half2float(b0, b1) {
  var s = (Math.floor(b0 / 128) == 0 ? 1 : -1);
  if (s == -1) b0 -= 128;
  var e = Math.floor(b0 / 4);
  b0 -= e * 4;
  var m = b0 * 256 + b1;
  if (e > 0 && e < 31)
    return s * Math.pow(2, e - 15) * (1 + m / 1024);
  else if (e == 0 && m == 0)
    return 0;
  else if (e == 0 && m != 0)
    return s * 6.1035 * (m / 1024) * 0.00001;
  else if (e == 31 && m == 0)
    return (s == 1 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY);
  return Number.NaN;
}

function float2half(c) {
  var s = 0;
  if (c < 0) {
    s = 1;
    c *= -1;
  }
  if (c > 65504) return (s == 0 ? [124, 0] : [252, 0]); //INF
  if (c == 0) return [0, 0];
  var m, e, ve;
  if (c < 0.0000610352) { // subnormal; 0.0000610352 = 2^-14
    e = 0;
    m = c * 16777216;     // 16777216.0 = 2^24
  }
  else for (var i=-14; i<=15; i++) {
    ve = Math.pow(2, i);
    m = c / ve;
    if (m < 2 && m >= 1) {
      e = i + 15;
      m = (m - 1) * 1024;
      break;
    }
  }
  var m0 = Math.floor(m / 256);
  var m1 = Math.floor(m - m0 * 256);
  return [s * 128 + e * 4 + m0, m1];
}
