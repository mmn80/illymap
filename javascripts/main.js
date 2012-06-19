"use strict";

var TOWNS_XML = "data/datafile_towns.xml";
var ALLIANCES_XML = "data/datafile_alliances.xml";
var DATA_JSON = "data/data.json";
var BG_IMAGE = "images/region_faction_map.png";
var STAR_IMAGE = "images/star.gif";
var ILLY_MAP_URL = "http://elgea.illyriad.co.uk/#/World/Map/{x}/{y}/10";

var MAP_WIDTH = 1000;
var OVR_NONE = "none", OVR_POP = "pop", OVR_PAR = "par";
var OVR_PAR_RACES = "races", OVR_PAR_ALLIANCES = "alliances";
var PAR_COLORS = [
  [0x00, 0xFF, 0x00],/*lime*/      [0x00, 0x00, 0xFF],/*blue*/   [0xFF, 0x00, 0xFF],/*fuchsia*/
  [0xFF, 0x00, 0x00],/*red*/       [0x00, 0xFF, 0xFF],/*cyan*/   [0xFF, 0xFF, 0x00],/*yellow*/
  [0xFF, 0xA5, 0x00],/*orange*/    [0x00, 0x80, 0x00],/*green*/  [0x80, 0x80, 0x00],/*olive*/
  [0x00, 0x00, 0xA0],/*darkblue*/  [0xA5, 0x2A, 0x2A],/*brown*/  [0x80, 0x00, 0x80],/*purple*/
  [0xAD, 0xD8, 0xE6],/*lightblue*/ [0x80, 0x00, 0x00],/*maroon*/ [0xC0, 0xC0, 0xC0] /*silver*/];
var KERNEL_UNIFORM_SIZE = 10;

var data = { server: "", date: "", alliances: [], towns: [] }; // data loaded from the json file, generated based on the Illy-supplied xmls

var capitals = [];

var map_state = {
  mx: 0,           // mousex
  my: 0,           // mousey
  sel_cap: null,   // selected (mouse over) alliance capital
  sel_par: 0,      // selected (mouse over) partition index
  ui_enabled: true
};

var overlay = {
  std_dev: 15,
  gamma: 0.8,
  mode: OVR_NONE,
  race: 0,
  par_mode: "",
  kernels: [],
  par_data: null
}

var gl;
var shaders = {
  main: null,
  overlay: null,
  stars: null,
  gauss_h: null,
  gauss_v: null,
  max_h: null,
  max_v: null,
  heat: null,
  partition: null
}
var mv_mat = mat4.create(), p_mat = mat4.create();

var buffers = {
  map_pos: null,
  max_h_pos: null,
  max_v_pos: null,
  tex_pos: null,
  stars_pos: null,
  stars_tex_pos: null,
  sel_star_pos: null,
  sel_star_tex_pos: null
};
var textures = {
  bg_map: null,     // TEXTURE0 1000x1000 byte  rgba (picture)
  star: null,       // TEXTURE1 512 x 512 byte  rgba (picture)
  towns: null,      // TEXTURE2 1000x1000 float rgba (4vals / sample)
  pids: null,       // TEXTURE3 1000x1000 byte  rgba (4pids / sample)
  max_h: null,      // TEXTURE4 100 x1000 byte  rgba (16bit.16bit fixed point encoding)
  max_v: null,      //          100 x 100 byte  rgba (16bit.16bit fixed point encoding)
  overlay_out: null,// TEXTURE5 1000x1000 byte  rgba
  gauss: [ null, null, null, null ],
                    // TEXTURE6-9
                    // 1000x1000 float rgb  (r and g used)
  bind_g_sampler: function(sampler, i) {
    if (i == 0) gl.activeTexture(gl.TEXTURE6);
    else if (i == 1) gl.activeTexture(gl.TEXTURE7);
    else if (i == 2) gl.activeTexture(gl.TEXTURE8);
    else if (i == 3) gl.activeTexture(gl.TEXTURE9);
    gl.bindTexture(gl.TEXTURE_2D, this.gauss[i]);
    gl.uniform1i(sampler, i + 6);
  }
}
var fbs = {
  max_h: null,
  max_v: null,
  overlay_out: null,
  gauss: [ null, null, null, null ],
  idx: {
    g: -1,
    g_prev: -1,
    g_h: -1,
    g_v: -1
  },
  next_fb: function() {
    for (var i=0; i<this.gauss.length; i++)
      if ([this.idx.g, this.idx.g_h, this.idx.g_v].indexOf(i) == -1) {
        this.idx.g_prev = this.idx.g;
        this.idx.g = i;
        break;
      }
    return this.gauss[this.idx.g];
  },
  find_dummy_idx: function(j) {
    if (j >= 0) return j;
    for (var i=0; i<this.gauss.length; i++)
      if ([this.idx.g, this.idx.g_h, this.idx.g_v, this.idx.g_prev].indexOf(i) == -1)
        return i;
  }
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
  $("#server_info").html("server: " + data.server + "<br/>date: " + data.date);
  capitals = [];
  if (data.alliances.length > 254)
    alert("Warning!\nThere are more then 254 alliances. Alliance partition computations will only consider the first 254 (less GPU memory needed). Other overlays are not affected.");
  for (var i=0; i<data.towns.length; i++) {
    var town = data.towns[i];
    town.x1 = Math.round((town.x + MAP_WIDTH) / 2);
    town.y1 = Math.round((town.y + MAP_WIDTH) / 2);
    if (town.r === undefined)
      town.r = "H";
    town.alliance = alliance_by_id(town.a);
    if (town.alliance) {
      if (town.alliance.p === undefined) town.alliance.p = 0;
      town.alliance.p += town.p;
    }
    if (town.c == 1) capitals.push(town);
  }
  data.alliances.sort(function(a, b) { return b.p - a.p; });
  for (var i=0; i<data.alliances.length; i++) {
    var a = data.alliances[i];
    a.index = i + 1;
    for (var j=0; j<a.conf.length; j++)
      a.conf[j] = alliance_by_id(a.conf[j]);
    for (var j=0; j<a.NAP.length; j++)
      a.NAP[j] = alliance_by_id(a.NAP[j]);
    for (var j=0; j<a.war.length; j++)
      a.war[j] = alliance_by_id(a.war[j]);
  }
  capitals.sort(function(a, b) { return a.p - b.p; });
  init_kernels();
  init_data_buffers();
  if ($("#overlay_mode").val() != OVR_NONE)
    recompute_overlay();
  else {
    init_towns_tex(0);
    draw();
  }
}

function init_kernels() {
  $("#std_dev option").each(function() {
    var kernel = { std_dev: $(this).val() };
    var half = 3 * kernel.std_dev; // 3*sigma coverage => less then 1% loss
    kernel.buffer = new Float32Array(1 + 2 * half);
    var factor1 = 2 * Math.pow(kernel.std_dev, 2), factor2 = kernel.std_dev * Math.sqrt(2 * Math.PI);
    for (var x=0; x<kernel.buffer.length; x++)
      kernel.buffer[x] = Math.exp(-Math.pow(x-half, 2) / factor1) / factor2;
    overlay.kernels.push(kernel);
  });
}

function init_webgl() {
  var canvas = $("#map")[0], ext = null, err = "";
  try {
    gl = canvas.getContext("experimental-webgl"/*, { preserveDrawingBuffer: true }*/);
    if (gl) ext = gl.getExtension("OES_texture_float");
  }
  catch (e) {
    err = "\n" + e;
  }
  if (!gl || !ext) {
    if (gl && !ext && err == "") err = "\nOES_texture_float not supported";
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
  shaders.main = create_program("main-fs", "main-vs");
  if (!shaders.main) return false;
  shaders.main.sampler_bg = gl.getUniformLocation(shaders.main, "sampler_bg");
  shaders.main.sampler_towns = gl.getUniformLocation(shaders.main, "sampler_towns");
  shaders.main.show_bg = gl.getUniformLocation(shaders.main, "show_bg");
  shaders.main.grey_bg = gl.getUniformLocation(shaders.main, "grey_bg");
  shaders.main.show_towns = gl.getUniformLocation(shaders.main, "show_towns");

  shaders.overlay = create_program("overlay-fs", "main-vs");
  if (!shaders.overlay) return false;
  shaders.overlay.sampler = gl.getUniformLocation(shaders.overlay, "sampler");

  shaders.stars = create_program("stars-fs", "main-vs");
  if (!shaders.stars) return false;
  shaders.stars.sampler = gl.getUniformLocation(shaders.stars, "sampler");
  shaders.stars.color = gl.getUniformLocation(shaders.stars, "color");

  shaders.gauss_h = create_program("gauss_h-fs", "main-vs");
  if (!shaders.gauss_h) return false;
  shaders.gauss_h.sampler_towns = gl.getUniformLocation(shaders.gauss_h, "sampler_towns");
  shaders.gauss_h.sampler_pids = gl.getUniformLocation(shaders.gauss_h, "sampler_pids");
  shaders.gauss_h.sampler_prev = gl.getUniformLocation(shaders.gauss_h, "sampler_prev");
  shaders.gauss_h.use_sampler_prev = gl.getUniformLocation(shaders.gauss_h, "use_sampler_prev");
  shaders.gauss_h.kernel = [];
  for (var i=0; i<KERNEL_UNIFORM_SIZE; i++)
    shaders.gauss_h.kernel.push(gl.getUniformLocation(shaders.gauss_h, "kernel[" + i + "]"));
  shaders.gauss_h.start_index = gl.getUniformLocation(shaders.gauss_h, "start_index");
  shaders.gauss_h.end_index = gl.getUniformLocation(shaders.gauss_h, "end_index");
  shaders.gauss_h.filter = gl.getUniformLocation(shaders.gauss_h, "filter");

  shaders.gauss_v = create_program("gauss_v-fs", "main-vs");
  if (!shaders.gauss_v) return false;
  shaders.gauss_v.sampler_gauss_h = gl.getUniformLocation(shaders.gauss_v, "sampler_gauss_h");
  shaders.gauss_v.sampler_comp = gl.getUniformLocation(shaders.gauss_v, "sampler_comp");
  shaders.gauss_v.sampler_prev = gl.getUniformLocation(shaders.gauss_v, "sampler_prev");
  shaders.gauss_v.use_sampler_prev = gl.getUniformLocation(shaders.gauss_v, "use_sampler_prev");
  shaders.gauss_v.kernel = [];
  for (var i=0; i<KERNEL_UNIFORM_SIZE; i++)
    shaders.gauss_v.kernel.push(gl.getUniformLocation(shaders.gauss_v, "kernel[" + i + "]"));
  shaders.gauss_v.start_index = gl.getUniformLocation(shaders.gauss_v, "start_index");
  shaders.gauss_v.end_index = gl.getUniformLocation(shaders.gauss_v, "end_index");
  shaders.gauss_v.filter = gl.getUniformLocation(shaders.gauss_v, "filter");
  shaders.gauss_v.compare = gl.getUniformLocation(shaders.gauss_v, "compare");

  shaders.max_h = create_program("max_h-fs", "main-vs");
  if (!shaders.max_h) return false;
  shaders.max_h.sampler = gl.getUniformLocation(shaders.max_h, "sampler");

  shaders.max_v = create_program("max_v-fs", "main-vs");
  if (!shaders.max_v) return false;
  shaders.max_v.sampler = gl.getUniformLocation(shaders.max_v, "sampler");

  shaders.heat = create_program("heat-fs", "main-vs");
  if (!shaders.heat) return false;
  shaders.heat.sampler = gl.getUniformLocation(shaders.heat, "sampler");
  shaders.heat.max_value = gl.getUniformLocation(shaders.heat, "max_value");
  shaders.heat.gamma = gl.getUniformLocation(shaders.heat, "gamma");

  shaders.partition = create_program("partition-fs", "main-vs");
  if (!shaders.partition) return false;
  shaders.partition.races_mode = gl.getUniformLocation(shaders.partition, "races_mode");
  shaders.partition.sampler = gl.getUniformLocation(shaders.partition, "sampler");
  shaders.partition.sel_par = gl.getUniformLocation(shaders.partition, "sel_par");
  shaders.partition.par_colors = [];
  for (var i=0; i<PAR_COLORS.length; i++)
    shaders.partition.par_colors.push(gl.getUniformLocation(shaders.partition, "par_colors[" + i + "]"));
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
    alert("Could not link program (shaders: " + vs_script_id + ", " + fs_script_id + ").\n\nInfoLog: " + gl.getProgramInfoLog(program));
    return null;
  }
  program.a_vtx_pos = gl.getAttribLocation(program, "a_vtx_pos");
  gl.enableVertexAttribArray(program.a_vtx_pos);
  program.a_tex_pos = gl.getAttribLocation(program, "a_tex_pos");
  gl.enableVertexAttribArray(program.a_tex_pos);
  program.p_mat = gl.getUniformLocation(program, "p_mat");
  program.mv_mat = gl.getUniformLocation(program, "mv_mat");
  return program;
}

function init_overlay_fb_tex() {
  for (var i=0; i<fbs.gauss.length; i++) {
    fbs.gauss[i] = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbs.gauss[i]);
    textures.gauss[i] = attach_tex_to_fb(MAP_WIDTH, MAP_WIDTH, gl.RGB, gl.FLOAT);
  }

  fbs.max_h = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbs.max_h);
  textures.max_h = attach_tex_to_fb(MAP_WIDTH / 10, MAP_WIDTH, gl.RGBA, gl.UNSIGNED_BYTE);

  fbs.max_v = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbs.max_v);
  textures.max_v = attach_tex_to_fb(MAP_WIDTH / 10, MAP_WIDTH / 10, gl.RGBA, gl.UNSIGNED_BYTE);

  fbs.overlay_out = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbs.overlay_out);
  textures.overlay_out = attach_tex_to_fb(MAP_WIDTH, MAP_WIDTH, gl.RGBA, gl.UNSIGNED_BYTE);

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

  buffers.map_pos = create_quad(MAP_WIDTH, MAP_WIDTH);
  buffers.max_h_pos = create_quad(MAP_WIDTH / 10, MAP_WIDTH);
  buffers.max_v_pos = create_quad(MAP_WIDTH / 10, MAP_WIDTH / 10);

  buffers.tex_pos = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.tex_pos);
  var textureCoords = [
      0.0, 0.0,
      1.0, 0.0,
      0.0, 1.0,
      1.0, 1.0
  ];
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(textureCoords), gl.STATIC_DRAW);
  buffers.tex_pos.itemSize = 2;
  buffers.tex_pos.numItems = 4;
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

  buffers.stars_pos = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.stars_pos);
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
  buffers.stars_pos.itemSize = 3;
  buffers.stars_pos.numItems = capitals.length * 6;

  var tex_pos = [
      0.0, 0.0,
      1.0, 0.0,
      0.0, 1.0,
      1.0, 0.0,
      0.0, 1.0,
      1.0, 1.0
  ];
  buffers.stars_tex_pos = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.stars_tex_pos);
  var textureCoords = [];
  for (var i=0; i<capitals.length; i++)
    for (var j=0; j<tex_pos.length; j++)
      textureCoords.push(tex_pos[j]);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(textureCoords), gl.STATIC_DRAW);
  buffers.stars_tex_pos.itemSize = 2;
  buffers.stars_tex_pos.numItems = capitals.length * 6;

  buffers.sel_star_pos = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.sel_star_pos);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vtx_pos), gl.STATIC_DRAW);
  buffers.sel_star_pos.itemSize = 3;
  buffers.sel_star_pos.numItems = 6;

  buffers.sel_star_tex_pos = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.sel_star_tex_pos);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(tex_pos), gl.STATIC_DRAW);
  buffers.sel_star_tex_pos.itemSize = 2;
  buffers.sel_star_tex_pos.numItems = 6;
}

function init_towns_tex(mode) {
  if (textures.pids && textures.pids.mode == mode) return;
  var towns_buffer = null, pids_buffer = new Uint8Array(MAP_WIDTH * MAP_WIDTH * 4);
  if (!textures.towns) towns_buffer = new Float32Array(MAP_WIDTH * MAP_WIDTH * 4);
  for (var i=0; i<data.towns.length; i++) {
    var town = data.towns[i];
    var x = Math.floor((town.x + MAP_WIDTH) / 2), y = Math.floor((town.y + MAP_WIDTH) / 2);
    var idx = 4 * (y * MAP_WIDTH + x);
    if ((town.x + MAP_WIDTH) % 2) idx++;
    if ((town.y + MAP_WIDTH) % 2) idx+=2;
    if (towns_buffer) towns_buffer[idx] = town.p;
    pids_buffer[idx] = (mode == 0 ? get_race_code(town.r) : (town.alliance ? town.alliance.index : 0));
  }
  if (!textures.towns) {
    textures.towns = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, textures.towns);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, MAP_WIDTH, MAP_WIDTH, 0, gl.RGBA, gl.FLOAT, towns_buffer);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }
  if (!textures.pids) textures.pids = gl.createTexture();
  textures.pids.mode = mode;
  gl.bindTexture(gl.TEXTURE_2D, textures.pids);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, MAP_WIDTH, MAP_WIDTH, 0, gl.RGBA, gl.UNSIGNED_BYTE, pids_buffer);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindTexture(gl.TEXTURE_2D, null);
}







// draw main ************************************************************************

function draw() {
  var v_map = $("#show_map").is(':checked');
  var v_tow = $("#show_towns").is(':checked');
  var v_cap = $("#show_capitals").is(':checked');

  mat4.ortho(0, MAP_WIDTH, 0, MAP_WIDTH, 0, 10, p_mat);
  mat4.identity(mv_mat);
  mat4.translate(mv_mat, [0.0, 0.0, -5.0]);

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, MAP_WIDTH, MAP_WIDTH);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  //gl.disable(gl.DEPTH_TEST);

  if (v_map || v_tow)
    draw_map(v_map, v_tow, v_cap);

  if (overlay.mode != OVR_NONE)
    draw_overlay();

  if (v_cap) {
    gl.useProgram(shaders.stars);
    gl.uniformMatrix4fv(shaders.stars.p_mat, false, p_mat);
    mat4.translate(mv_mat, [0, 0, 1.0]);
    draw_stars(buffers.stars_pos, buffers.stars_tex_pos, { r: 232, g: 222, b: 49 });
    if (map_state.sel_cap) {
      var pos = get_town_pos(map_state.sel_cap, true);
      mat4.translate(mv_mat, [pos.x, pos.y, 1.0]);
      mat4.scale(mv_mat, [pos.scale, pos.scale, 1.0]);
      draw_stars(buffers.sel_star_pos, buffers.sel_star_tex_pos, { r: 0, g: 255, b: 0 });
    }
  }
}

function draw_map(v_map, v_tow, v_cap) {
  gl.useProgram(shaders.main);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, textures.bg_map);
  gl.uniform1i(shaders.main.sampler_bg, 0);
  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, textures.towns);
  gl.uniform1i(shaders.main.sampler_towns, 2);

  gl.uniform1i(shaders.main.show_bg, v_map);
  gl.uniform1i(shaders.main.show_towns, v_tow);
  gl.uniform1i(shaders.main.grey_bg, v_cap || v_tow || overlay.mode != OVR_NONE);

  gl.uniformMatrix4fv(shaders.main.mv_mat, false, mv_mat);
  gl.uniformMatrix4fv(shaders.main.p_mat, false, p_mat);

  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.tex_pos);
  gl.vertexAttribPointer(shaders.main.a_tex_pos, buffers.tex_pos.itemSize, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.map_pos);
  gl.vertexAttribPointer(shaders.main.a_vtx_pos, buffers.map_pos.itemSize, gl.FLOAT, false, 0, 0);

  gl.drawArrays(gl.TRIANGLE_STRIP, 0, buffers.map_pos.numItems);
}

function draw_overlay() {
  gl.useProgram(shaders.overlay);
  gl.enable(gl.BLEND);

  gl.activeTexture(gl.TEXTURE5);
  gl.bindTexture(gl.TEXTURE_2D, textures.overlay_out);
  gl.uniform1i(shaders.overlay.sampler, 5);

  mat4.translate(mv_mat, [0, 0, 1.0]);
  gl.uniformMatrix4fv(shaders.overlay.mv_mat, false, mv_mat);
  gl.uniformMatrix4fv(shaders.overlay.p_mat, false, p_mat);

  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.tex_pos);
  gl.vertexAttribPointer(shaders.overlay.a_tex_pos, buffers.tex_pos.itemSize, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.map_pos);
  gl.vertexAttribPointer(shaders.overlay.a_vtx_pos, buffers.map_pos.itemSize, gl.FLOAT, false, 0, 0);

  gl.drawArrays(gl.TRIANGLE_STRIP, 0, buffers.map_pos.numItems);
}

function draw_stars(vtx_buffer, tex_buffer, color) {
  gl.uniform3f(shaders.stars.color, color.r / 255, color.g / 255, color.b / 255);
  gl.uniformMatrix4fv(shaders.stars.mv_mat, false, mv_mat);

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE);

  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, textures.star);
  gl.uniform1i(shaders.stars.sampler, 1);

  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.stars_tex_pos);
  gl.vertexAttribPointer(shaders.stars.a_tex_pos, buffers.stars_tex_pos.itemSize, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, vtx_buffer);
  gl.vertexAttribPointer(shaders.stars.a_vtx_pos, vtx_buffer.itemSize, gl.FLOAT, false, 0, 0);

  gl.drawArrays(gl.TRIANGLES, 0, tex_buffer.numItems);
}






// draw overlay ************************************************************************

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
  }
  init_towns_tex(overlay.mode == OVR_PAR && overlay.par_mode == OVR_PAR_ALLIANCES ? 1 : 0);
  if (overlay.mode != OVR_NONE) {
    enable_ui(false);
    setTimeout('recompute_overlay_draw()', 50);
  }
  else draw();
}

function recompute_overlay_draw() {
  mat4.identity(mv_mat);
  mat4.translate(mv_mat, [0.0, 0.0, -4.0]);
  mat4.ortho(0, MAP_WIDTH, 0, MAP_WIDTH, 0, 10, p_mat);

  if (overlay.mode == OVR_POP) {
    var filter = overlay.race / 255;
    draw_gauss_h(filter);
    draw_gauss_v(filter, false);
    draw_max_h();
    var max_value = draw_max_v();
    draw_heat(max_value);
    draw();
    enable_ui(true);
  }
  else if (overlay.mode == OVR_PAR) {
    var p_data = [], idx = 0;
    var part_pass = function() {
      draw_gauss_h(p_data[idx]);
      draw_gauss_v(p_data[idx], idx > 0);
      idx++;
      if (idx < p_data.length)
        setTimeout(function () { part_pass(); }, 10);
      else setTimeout(function () { last_step(); }, 10);
    };
    var last_step = function() {
      overlay.par_data = new Uint8Array(4 * MAP_WIDTH * MAP_WIDTH);
      gl.readPixels(0, 0, MAP_WIDTH, MAP_WIDTH, gl.RGBA, gl.UNSIGNED_BYTE, overlay.par_data);
      draw_partition();
      draw();
      setTimeout(function () { enable_ui(true); }, 10);
    };

    if (overlay.par_mode == OVR_PAR_RACES) {
      var races = ["E", "H", "D", "O"];
      for (var i=0; i<races.length; i++)
        p_data.push(get_race_code(races[i]) / 255);
    }
    else if (overlay.par_mode == OVR_PAR_ALLIANCES)
      for (var i=0; i<data.alliances.length; i++)
        p_data.push(data.alliances[i].index / 255);
    part_pass();
  }
}

function draw_gauss_h(filter) {
  gl.useProgram(shaders.gauss_h);
  fbs.idx.g = -1;
  fbs.idx.g_prev = -1;

  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, textures.towns);
  gl.uniform1i(shaders.gauss_h.sampler_towns, 2);
  gl.activeTexture(gl.TEXTURE3);
  gl.bindTexture(gl.TEXTURE_2D, textures.pids);
  gl.uniform1i(shaders.gauss_h.sampler_pids, 3);

  gl.uniform1f(shaders.gauss_h.filter, filter);

  var more = true, idx = 0;
  while (more) {
    var fb = fbs.next_fb();
    textures.bind_g_sampler(shaders.gauss_h.sampler_prev, fbs.find_dummy_idx(fbs.idx.g_prev));
    gl.uniform1i(shaders.gauss_h.use_sampler_prev, idx > 0);
    more = upload_kernel(shaders.gauss_h, idx);
    draw_overlay_main(fb, shaders.gauss_h, buffers.map_pos, MAP_WIDTH, MAP_WIDTH);
    idx += KERNEL_UNIFORM_SIZE;
  }

  fbs.idx.g_h = fbs.idx.g;
}

function draw_gauss_v(filter, compare) {
  gl.useProgram(shaders.gauss_v);
  fbs.idx.g_prev = -1;

  textures.bind_g_sampler(shaders.gauss_v.sampler_gauss_h, fbs.idx.g_h);
  textures.bind_g_sampler(shaders.gauss_v.sampler_comp, fbs.find_dummy_idx(fbs.idx.g_v));

  gl.uniform1f(shaders.gauss_v.filter, filter);

  var more = true, idx = 0;
  while (more) {
    var fb = fbs.next_fb();
    textures.bind_g_sampler(shaders.gauss_v.sampler_prev, fbs.find_dummy_idx(fbs.idx.g_prev));
    gl.uniform1i(shaders.gauss_v.use_sampler_prev, idx > 0);
    more = upload_kernel(shaders.gauss_v, idx);
    gl.uniform1f(shaders.gauss_v.compare, compare && !more);
    draw_overlay_main(fb, shaders.gauss_v, buffers.map_pos, MAP_WIDTH, MAP_WIDTH);
    idx += KERNEL_UNIFORM_SIZE;
  }

  fbs.idx.g_v = fbs.idx.g;
}

function draw_max_h() {
  gl.useProgram(shaders.max_h);

  textures.bind_g_sampler(shaders.max_h.sampler, fbs.idx.g_v);

  draw_overlay_main(fbs.max_h, shaders.max_h, buffers.max_h_pos, MAP_WIDTH / 10, MAP_WIDTH);
}

function draw_max_v() {
  gl.useProgram(shaders.max_v);

  gl.activeTexture(gl.TEXTURE4);
  gl.bindTexture(gl.TEXTURE_2D, textures.max_h);
  gl.uniform1i(shaders.max_v.sampler, 4);

  draw_overlay_main(fbs.max_v, shaders.max_v, buffers.max_v_pos, MAP_WIDTH / 10, MAP_WIDTH / 10);

  var pixels = new Uint8Array(4 * MAP_WIDTH * MAP_WIDTH / 100);
  gl.readPixels(0, 0, MAP_WIDTH / 10, MAP_WIDTH / 10, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  var max_val = 0;
  for (var i=0; i<pixels.length; i+=4) {
    var val1 = 256 * pixels[i] + pixels[i + 1];
    var val2 = 256 * pixels[i + 2] + pixels[i + 3];
    var val = val1 + val2 / 65536;
    if (val > max_val)
      max_val = val;
  }
  return max_val;
}

function draw_heat(max_value) {
  gl.useProgram(shaders.heat);

  textures.bind_g_sampler(shaders.heat.sampler, fbs.idx.g_v);
  gl.uniform1f(shaders.heat.max_value, max_value);
  gl.uniform1f(shaders.heat.gamma, overlay.gamma);

  draw_overlay_main(fbs.overlay_out, shaders.heat, buffers.map_pos, MAP_WIDTH, MAP_WIDTH);
}

function draw_partition() {
  gl.useProgram(shaders.partition);
  mat4.identity(mv_mat);
  mat4.translate(mv_mat, [0.0, 0.0, -4.0]);

  textures.bind_g_sampler(shaders.partition.sampler, fbs.idx.g_v);
  for (var i=0; i<PAR_COLORS.length; i++) {
    var c = PAR_COLORS[i];
    gl.uniform3f(shaders.partition.par_colors[i], c[0] / 255, c[1] / 255, c[2] / 255);
  }
  gl.uniform1f(shaders.partition.sel_par, map_state.sel_par / 255);
  gl.uniform1i(shaders.partition.races_mode, overlay.par_mode == OVR_PAR_RACES);

  draw_overlay_main(fbs.overlay_out, shaders.partition, buffers.map_pos, MAP_WIDTH, MAP_WIDTH);
}

// draw overlay utils

function draw_overlay_main(fb, shader, vtx_buffer, width, height) {
  mat4.ortho(0, width, 0, height, 0, 10, p_mat);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.viewport(0, 0, width, height);
  gl.disable(gl.BLEND);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.uniformMatrix4fv(shader.mv_mat, false, mv_mat);
  gl.uniformMatrix4fv(shader.p_mat, false, p_mat);
  gl.bindBuffer(gl.ARRAY_BUFFER, vtx_buffer);
  gl.vertexAttribPointer(shader.a_vtx_pos, vtx_buffer.itemSize, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.tex_pos);
  gl.vertexAttribPointer(shader.a_tex_pos, buffers.tex_pos.itemSize, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, vtx_buffer.numItems);
}

function upload_kernel(shader, idx) {
  var kernel = null;
  for (var i=0; i<overlay.kernels.length; i++)
    if (overlay.kernels[i].std_dev == overlay.std_dev) {
      kernel = overlay.kernels[i].buffer;
      break;
    }
  var half = Math.floor(kernel.length / 2);
  var start_index = idx - half;
  var end_index = start_index + KERNEL_UNIFORM_SIZE - 1;
  if (end_index + half >= kernel.length)
    end_index = kernel.length - half - 1;
  gl.uniform1i(shader.start_index, start_index);
  gl.uniform1i(shader.end_index, end_index);
  for (var i=0; i<end_index - start_index + 1; i++)
    gl.uniform1f(shader.kernel[i], kernel[idx + i]);
  return idx + KERNEL_UNIFORM_SIZE < kernel.length;
}







// events *********************************************************************

function map_mousemove(event) {
  var old_sel_cap = map_state.sel_cap;
  map_state.sel_cap = null;
  var old_sel_par = map_state.sel_par;
  map_state.sel_par = 0;

  var off = $("#map").offset();
  map_state.mx = parseInt(event.pageX - off.left);
  map_state.my = MAP_WIDTH - parseInt(event.pageY - off.top);
  map_state.illy_x = map_state.mx * 2 - MAP_WIDTH;
  map_state.illy_y = map_state.my * 2 - MAP_WIDTH;

  var illyx = map_state.illy_x.toString(), illyy = map_state.illy_y.toString();
  while (illyx.length < 4) illyx = " " + illyx;
  while (illyy.length < 4) illyy = " " + illyy;
  illyx = illyx.replace(/ /g, "&nbsp;");
  illyy = illyy.replace(/ /g, "&nbsp;");
  $("#pos_info").html("[" + illyx + ":" + illyy + "]");
  $("#pos_info").show();

  if (!map_state.ui_enabled) return;

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
  if (overlay.mode == OVR_PAR && overlay.par_data) {
    var idx = 4 * (map_state.my * MAP_WIDTH + map_state.mx) + 1;
    map_state.sel_par = overlay.par_data[idx];
  }

  if (map_state.sel_cap == old_sel_cap && map_state.sel_par == old_sel_par) return;

  if (!map_state.sel_cap && !map_state.sel_par)
    $("#infobox").hide();
  else if (map_state.sel_cap) {
    $("#infobox").html("<i>" + map_state.sel_cap.name + "</i><br />" +
      "capital of <strong>" + map_state.sel_cap.alliance.name + "</strong><br />" +
      "population: " + add_commas(map_state.sel_cap.p));
    var pos = $("#map").position();
    $("#infobox").css({
        position: "absolute",
        top: (pos.top + MAP_WIDTH - town.y1 - 60) + "px",
        left: (pos.left + town.x1 + 15) + "px"
    }).show();
  }
  else if (map_state.sel_par) {
    var message, dy = 20;
    if (overlay.par_mode == OVR_PAR_RACES)
      message = "<span class=\"hint_label\">race:</span> <strong>" + get_race_name(map_state.sel_par) + "</strong>";
    else if (overlay.par_mode == OVR_PAR_ALLIANCES) {
      dy = 120;
      message = "<span class=\"hint_label\">alliance:</span> <strong>";
      var a = data.alliances[map_state.sel_par - 1];
      message += a.name + "</strong> (ticker: <strong>" + a.tck + "</strong>)";
      message += "<br /><span class=\"hint_label\">founded:</span> " + a.date;
      message += "<br /><span class=\"hint_label\">population:</span> " + add_commas(a.p) + " (" + a.m + " members)" + "<br />";
      if (a.conf.length > 0) {
        message += "<br /><span class=\"hint_label\">confeds:</span> <span style=\"color:#99FF99;font-weight:bold\">";
        for (var i=0; i<a.conf.length; i++)
          message += (i ? ", ": "") + a.conf[i].tck;
        message += "</span>";
      }
      if (a.NAP.length > 0) {
        message += "<br /><span class=\"hint_label\">NAPs:</span> ";
        for (var i=0; i<a.NAP.length; i++)
          message += (i ? ", ": "") + a.NAP[i].tck;
      }
      if (a.war.length > 0) {
        message += "<br /><span class=\"hint_label\">wars:</span> <span style=\"color:#FF3333;font-weight:bold\">";
        for (var i=0; i<a.war.length; i++)
          message += (i ? ", ": "") + a.war[i].name + " (" + a.war[i].tck + ")";
        message += "</span>";
      }
    }
    $("#infobox").html(message);
    var pos = $("#map").position();
    $("#infobox").css({
        position: "absolute",
        top: (pos.top + MAP_WIDTH - map_state.my - dy) + "px",
        left: (pos.left + map_state.mx + 15) + "px"
    }).show();
  }

  if (map_state.sel_par != old_sel_par)
    draw_partition();
  draw();
}

function map_mouseout(event) {
  $("#pos_info").hide();
  if (map_state.ui_enabled)
    $("#infobox").hide();
  if (map_state.sel_par > 0) {
    map_state.sel_par = 0;
    if (map_state.ui_enabled) {
      draw_partition();
      draw();
    }
  }
}

function map_dblclick(event) {
  var x = (event.pageX - this.offsetLeft) * 2 - MAP_WIDTH;
  var y = MAP_WIDTH - (event.pageY - this.offsetTop) * 2;
  window.open(ILLY_MAP_URL.replace("{x}", x).replace("{y}", y), '_blank');
}








// utils *******************************************************************

function enable_ui(en) {
  map_state.ui_enabled = en;
  var ui = ["overlay_mode", "std_dev", "gamma", "show_map", "show_towns", "show_capitals"];
  for (var i=0; i<ui.length; i++) {
    var el = $("#" + ui[i]);
    if (en) el.removeAttr('disabled');
    else el.attr('disabled', 'disabled');
  }
  if (!en) {
    $("#infobox").html('<span class="chuggin">I\'M CHUGGIN GIGABYTES<br />wait a sec...</span>');
    var pos = $("#map").position();
    $("#infobox").css({
        position: "absolute",
        top: (pos.top + Math.floor(MAP_WIDTH / 2) - 200) + "px",
        left: (pos.left + Math.floor(MAP_WIDTH / 2) - 150) + "px"
    }).show();
  }
  else $("#infobox").hide();
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
  str = str.replace(/{KERNEL_UNIFORM_SIZE}/g, KERNEL_UNIFORM_SIZE);
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

function attach_tex_to_fb(width, height, type, el_type) {
  var tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, type, width, height, 0, type, el_type, null);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  if (type == gl.FLOAT && gl.checkFramebufferStatus(gl.FRAMEBUFFER) != gl.FRAMEBUFFER_COMPLETE)
     alert("Error: browser rejected FLOAT as the color attachment to an FBO");
  return tex;
}

function get_town_pos(town, is_selected) {
  var r = Math.floor(Math.sqrt(town.p / 50));
  if (is_selected) r *= 1.5;
  if (r < 4) r = 4;
  var x = town.x1 - r, y = town.y1 - r;
  return { x: x, y: y, scale: 2 * r }
}

function get_race_code(race_str) {
  if (race_str == "E") return 1;
  else if (race_str == "H") return 2;
  else if (race_str == "D") return 3;
  else if (race_str == "O") return 4;
  return 0;
}

function get_race_name(race_code) {
  if (race_code == 1) return "Elves";
  else if (race_code == 2) return "Humans";
  else if (race_code == 3) return "Dwarves";
  else if (race_code == 4) return "Orcs";
  return "?";
}

function alliance_by_id(id) {
  for (var i=0; i<data.alliances.length; i++) {
    var a = data.alliances[i];
    if (a.id == id) return a;
  }
  return null;
}

function add_commas(str) {
  str += '';
  var x = str.split('.');
  var x1 = x[0];
  var x2 = x.length > 1 ? '.' + x[1] : '';
  var rgx = /(\d+)(\d{3})/;
  while (rgx.test(x1)) {
    x1 = x1.replace(rgx, '$1' + ',' + '$2');
  }
  return x1 + x2;
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
        a.date = xml_a.children("foundeddatetime").text().substring(0, 10);
        var mem = parseInt(xml_a.children("membercount").text());
        a.m = mem;
        if (mem > 0) {
          a.NAP = [];
          a.conf = [];
          a.war = [];
          xml_a.find("relationship").each(function () {
            var xml_rel = $(this);
            var t = xml_rel.children("relationshiptype").text();
            var al_id = xml_rel.children("proposedbyalliance").attr("id");
            if (al_id == a.id) al_id = xml_rel.children("acceptedbyalliance").attr("id");
            if (t == "NAP") a.NAP.push(parseInt(al_id));
            else if (t == "Confederation") a.conf.push(parseInt(al_id));
            else if (t == "War") a.war.push(parseInt(al_id));
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
      data.date = server.children("datagenerationdatetime").text().substring(0, 10);
      $(xml).children("towns").children("town").each(function() {
        var t = {}, xml_t = $(this);
        var loc = xml_t.children("location"), pl = xml_t.children("player"), dat = xml_t.children("towndata");
        //t.d = dat.children("foundeddatetime").text().substring(2, 5);
        t.p = parseInt(dat.children("population").text());
        if (dat.children("isalliancecapitalcity").text() == "1") {
          t.c = 1;
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
