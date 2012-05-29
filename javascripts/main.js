//"use strict";

var data = { alliances: [], towns: [] };
var bg_img = new Image();

$(document).ready(function () {
  var img_loaded = false, data_loaded = false;
  bg_img.onload = function() {
    img_loaded = true;
    if (data_loaded) paint();
  };
  bg_img.src="images/region_faction_map.gif";
  $.getJSON('data/data.json', function(d) {
    data = d;
    data_loaded = true;
    if (img_loaded) paint();
  });
});

function loadXml() {
  var al_loaded = false, to_loaded = false;
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
      $(xml).children("towns").children("town").each(function() {
        var t = {}, xml_t = $(this);
        var loc = xml_t.children("location"), pl = xml_t.children("player"), dat = xml_t.children("towndata");
        t.p = parseInt(dat.children("population").text());
        var cap = (dat.children("iscapitalcity").text() == "1");
        var acap = (dat.children("isalliancecapitalcity").text() == "1");
        var capital = (cap && acap ? 3 : (acap ? 2 : (cap ? 1 : 0)));
        if (capital > 0) t.c = capital;
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

function paint() {
  var ctx = $("#map")[0].getContext("2d");
  ctx.drawImage(bg_img, 0, 0, 1000, 1000);
  ctx.globalAlpha = 0.8;
  ctx.beginPath();
  ctx.rect(0, 0, 1000, 1000);
  ctx.fillStyle = "black";
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.font = "italic 40pt Calibri";
  ctx.fillStyle = "white";
  ctx.fillText("Number of alliances: " + data.alliances.length, 150, 100);
  ctx.fillText("Number of towns: " + data.towns.length, 150, 150);
}
