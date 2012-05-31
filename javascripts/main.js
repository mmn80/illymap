//"use strict";

var TOWNS_XML = "data/datafile_towns.xml";
var ALLIANCES_XML = "data/datafile_alliances";
var SQRT2PI = Math.sqrt(2 * Math.PI);

var data = { server: "", date: "", alliances: [], towns: [] };
var bg_img = new Image();
var capitals = [];
var map_state = {
  mx: 0, //mousex
  my: 0, //mousey
  sel_cap: null //selected alliance capital
};
var overlay = {
  std_dev: 10,  //standard deviation (UI)
  mode: "none", //overlay mode (UI)
  buffers: [],  //map overlays as 1000x1000 int32 arraybuffers, values represent populations
  kernels: []   //precomputed gaussian distributions of form { std_dev: val, width: kernel_width, kernel: float32_array_buffer }
}

$(document).ready(function () {
  var img_loaded = false, data_loaded = false;
  bg_img.onload = function() {
    img_loaded = true;
    if (data_loaded) initialize();
  };
  $("#show_towns").click(paint);
  $("#show_capitals").click(paint);
  $("#overlay_mode").change(recompute_overlay);
  $("#std_dev").change(recompute_overlay);
  $("#xml2json_btn").click(loadXml);
  $("#map").mousemove(map_mousemove);
  bg_img.src="images/region_faction_map.gif";
  $.getJSON('data/data.json', function(d) {
    data = d;
    data_loaded = true;
    if (img_loaded) initialize();
  });
});

function initialize() {
  $("#server_info").html("server: " + data.server + "<br/>date: " + data.date);
  capitals = [];
  for (var i=0; i<data.towns.length; i++) {
    var town = data.towns[i];
    town.x1 = Math.round((town.x + 1000) / 2);
    town.y1 = -Math.round((town.y + 1000) / 2) + 1000;
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
  capitals.sort(function(a, b) {
    return a.p - b.p;
  });
  paint();
}

function recompute_overlay() {
  overlay.std_dev = parseInt($("#std_dev").val());
  overlay.mode = $("#overlay_mode").val();
  
  // search for cached Gaussian kernel
  
  var kernel = null;
  for (var i=0; i<overlay.kernels.length; i++)
    if (overlay.kernels[i].std_dev == overlay.std_dev) {
      kernel = overlay.kernels[i];
      break;
    }
  if (!kernel) {
    
    // compute kernel
    
    kernel = { std_dev: overlay.std_dev };
    var half = 3 * kernel.std_dev; // 3*sigma coverage => less then 0.5% loss
    kernel.width = 1 + 2 * half;   // add 1 so that there is a (0,0) pixel in the middle
    kernel.buffer = new Float32Array(new ArrayBuffer(4 * kernel.width * kernel.width));
    var factor1 = 2 * Math.pow(kernel.std_dev, 2), factor2 = Math.PI * factor1;
    for (var y=0; y<kernel.width; y++)
      for (var x=0; x<kernel.width; x++)
        kernel.buffer[y * kernel.width + x] = Math.exp(-(Math.pow(x-half, 2) + Math.pow(y-half, 2)) / factor1) / factor2;
    overlay.kernels.push(kernel);
  }
  paint();
}

function paint() {
  var ctx = $("#map")[0].getContext("2d");
  
  //paint background image
  
  ctx.drawImage(bg_img, 0, 0, 1000, 1100);
  ctx.globalAlpha = 0.8;
  ctx.beginPath();
  ctx.rect(0, 0, 1000, 1000);
  ctx.fillStyle = "black";
  ctx.fill();
  ctx.globalAlpha = 1;
  
  //paint towns
  
  var imgd = ctx.getImageData(0, 0, 1000, 1000);
  if ($("#show_towns").is(':checked'))
    for (var i=0; i<data.towns.length; i++) {
      var town = data.towns[i];
      if (town.c != 1) {
        var idx = (town.x1 + (town.y1 * imgd.width)) * 4;        
        imgd.data[idx] = 0;
        imgd.data[idx+1] = 0;
        imgd.data[idx+2] = 255;
        imgd.data[idx+3] = 255;
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
  if (map_state.sel_cap != old_sel_cap)
    paint();
}

function info_box(ctx, x, y, lines) {
  var w = 0, h = 0, r = 4;
  
  //complete line info with defaults & compute bounds
  
  for (var i=0; i<lines.length; i++) {
    var l = lines[i];
    if (l.font === undefined) l.font = "Calibri";
    if (l.height === undefined) l.height = 12;
    if (l.italic === undefined) l.italic = false;
    l.font_line = (l.italic ? "italic " : "") + l.height + "px " + l.font;
    ctx.font = l.font_line;
    var m = ctx.measureText(l.text);
    l.width = m.width;
    h += l.height;
    if (w < l.width) w = l.width;
  }
  w += 2 * r;
  h += 2 * r;
  
  //fix position
  
  if (x > 1000 - w) x = 1000 - w;
  if (y > 1000 - h) y = 1000 - h;
  if (y < 0) y = 0;
  if (x < 0) x = 0;
  
  //draw box
  
  ctx.globalAlpha = 0.4;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  ctx.fillStyle = "yellow";
  ctx.fill();
  
  //draw text
  
  ctx.globalAlpha = 1;
  var text_y = y + r / 2, text_x = x + r;
  ctx.fillStyle = "white";
  for (var i=0; i<lines.length; i++) {
    var l = lines[i];
    text_y += l.height;
    ctx.font = l.font_line;
    ctx.fillText(l.text, text_x, text_y);
  }
}

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
        if (mem > 0) data.alliances.push(a);
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
        if (race != "H") t.r= race;
        if (t.p > 0) data.towns.push(t);
      });
      to_loaded = true;
      if (al_loaded) generateJson();
    }
  });
}