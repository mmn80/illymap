//"use strict";

var data = { server: "", date: "", alliances: [], towns: [] };
var bg_img = new Image();

$(document).ready(function () {
  var img_loaded = false, data_loaded = false;
  bg_img.onload = function() {
    img_loaded = true;
    if (data_loaded) initialize();
  };
  $("#show_towns").click(paint);
  $("#xml2json_btn").click(loadXml);
  bg_img.src="images/region_faction_map.gif";
  $.getJSON('data/data.json', function(d) {
    data = d;
    data_loaded = true;
    if (img_loaded) initialize();
  });
});

function loadXml() {
  var al_loaded = false, to_loaded = false;
  data = { server: "", date: "", alliances: [], towns: [] };
  
  var generateJson = function() {
    var div = $("#jsondiv");
    var json_text = JSON.stringify(data, null, 2);
    div.show();
    div.append(json_text);
  }
  
  $.ajax({
    type: "GET",
    url: "data/datafile_alliances.xml",
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
    url: "data/datafile_towns.xml",
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

function initialize() {
  $("#server_info").html("server: " + data.server + "<br/>date: " + data.date);
  paint();
}

function paint() {
  var ctx = $("#map")[0].getContext("2d");
  ctx.drawImage(bg_img, 0, 0, 1000, 1100);
  ctx.globalAlpha = 0.8;
  ctx.beginPath();
  ctx.rect(0, 0, 1000, 1000);
  ctx.fillStyle = "black";
  ctx.fill();
  ctx.globalAlpha = 1;
  //ctx.font = "italic 40pt Calibri";
  //ctx.fillStyle = "white";
  //ctx.fillText("Number of alliances: " + data.alliances.length, 150, 100);
  //ctx.fillText("Number of towns: " + data.towns.length, 150, 150);
  var imgd = ctx.getImageData(0, 0, 1000, 1100);
  if ($("#show_towns").is(':checked'))
    for (var i=0; i<data.towns.length; i++) {
      var town = data.towns[i];
      var x = Math.round((town.x + 1000) / 2);
      var y = -Math.round((town.y + 1000) / 2) + 1000;
      if (town.c == 1) {
        point(imgd, x, y, 0xE8, 0xDE, 0x31, 0xFF);
        point(imgd, x+1, y, 0xE8, 0xDE, 0x31, 0xFF);
        point(imgd, x, y+1, 0xE8, 0xDE, 0x31, 0xFF);
        point(imgd, x+1, y+1, 0xE8, 0xDE, 0x31, 0xFF);
        point(imgd, x, y-1, 0xE8, 0xDE, 0x31, 0xA0);
        point(imgd, x+1, y-1, 0xE8, 0xDE, 0x31, 0xA0);
        point(imgd, x, y+2, 0xE8, 0xDE, 0x31, 0xA0);
        point(imgd, x+1, y+2, 0xE8, 0xDE, 0x31, 0xA0);
        point(imgd, x-1, y, 0xE8, 0xDE, 0x31, 0xA0);
        point(imgd, x-1, y+1, 0xE8, 0xDE, 0x31, 0xA0);
        point(imgd, x+2, y, 0xE8, 0xDE, 0x31, 0xA0);
        point(imgd, x+2, y+1, 0xE8, 0xDE, 0x31, 0xA0);
        point(imgd, x-1, y-1, 0xE8, 0xDE, 0x31, 0x30);
        point(imgd, x+2, y-1, 0xE8, 0xDE, 0x31, 0x30);
        point(imgd, x-1, y+2, 0xE8, 0xDE, 0x31, 0x30);
        point(imgd, x+2, y+2, 0xE8, 0xDE, 0x31, 0x30);
      }
      else point(imgd, x, y, 0, 0, 255, 255);
    }
  ctx.putImageData(imgd, 0, 0);
}

function point(imgd, x, y, r, g, b, a) {            
  var idx = (x + (y * imgd.width)) * 4;        
  imgd.data[idx] = r;
  imgd.data[idx+1] = g;
  imgd.data[idx+2] = b;
  imgd.data[idx+3] = a;
}