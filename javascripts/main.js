//"use strict";

var alliances = [];
var players = [];
var towns = [];
var ctx, bg_img = new Image();
var img_loaded = false, al_loaded = false, pl_loaded = false, to_loaded = false;

$(document).ready(function () {
  ctx = $("#map")[0].getContext("2d");
  
  bg_img.onload = function() {
    img_loaded = true;
    data_loaded();
  };
  bg_img.src="images/region_faction_map.gif";
  
  //load alliances from xml
  
  $.ajax({
    type: "GET",
    url: "data/datafile_alliances.xml",
    dataType: "xml",
    success: function(xml) {
      $(xml).find("alliance").each(function() {
        var a = {}, xml_a = $(this);
        a.id = xml_a.find("alliance").attr("id");
        a.capital = xml_a.find("alliancecapitaltownid").attr("id");
        a.ticker = xml_a.find("allianceticker").text();
        a.founded = xml_a.find("foundeddatetime").text();
        a.members = xml_a.find("membercount").text();
        a.population = xml_a.find("totalpopulation").text();
        a.NAPs = [];
        a.confeds = [];
        xml_a.find("relationship").each(function () {
          var xml_rel = $(this);
          var t = xml_rel.find("relationshiptype").text();
          var al_id = xml_rel.find("proposedbyalliance").attr("id");
          if (al_id == a.id) al_id = xml_rel.find("acceptedbyalliance").attr("id");
          if (t == "NAP") a.NAPs.push(al_id);
          else if (t == "Confederation") a.confeds.push(al_id);
        });
        alliances.push(a);
      });
      al_loaded = true;
      data_loaded();
    }
  });
  
  //load players from xml
  
  $.ajax({
    type: "GET",
    url: "data/datafile_players.xml",
    dataType: "xml",
    success: function(xml) {
      $(xml).find("player").each(function() {
        var p = {}, xml_p = $(this);
        p.id = xml_p.find("playername").attr("id");
        p.name = xml_p.find("playername").text();
        p.alliance = xml_p.find("allianceid").attr("id");
        p.race = xml_p.find("race").attr("id");
        players.push(p);
      });
      pl_loaded = true;
      data_loaded();
    }
  });
  
  //load towns from xml
  
  $.ajax({
    type: "GET",
    url: "data/datafile_towns.xml",
    dataType: "xml",
    success: function(xml) {
      $(xml).find("town").each(function() {
        var t = {}, xml_t = $(this);
        var loc = xml_t.find("location"), pl = xml_t.find("player"), dat = xml_t.find("towndata");
        t.id = dat.find("townname").attr("id");
        t.name = dat.find("townname").text();
        t.population = dat.find("population").text();
        t.capital = (dat.find("iscapitalcity").text() == "1");
        t.al_capital = (dat.find("isalliancecapitalcity").text() == "1");
        t.x = loc.find("mapx").text();
        t.y = loc.find("mapy").text();
        t.player = pl.find("playername").attr("id");
        t.alliance = pl.find("playeralliance").find("alliancename").attr("id");
        towns.push(t);
      });
      to_loaded = true;
      data_loaded();
    }
  });
});

function data_loaded() {
  if (!img_loaded || !al_loaded || !pl_loaded || !to_loaded) return;
  ctx.drawImage(bg_img, 0, 0, 1000, 1000);
  ctx.globalAlpha = 0.8;
  ctx.beginPath();
  ctx.rect(0, 0, 1000, 1000);
  ctx.fillStyle = "black";
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.font = "italic 40pt Calibri";
  ctx.fillStyle = "white";
  ctx.fillText("Number of alliances: " + alliances.length, 150, 100);
  ctx.fillText("Number of players: " + players.length, 150, 150);
  ctx.fillText("Number of towns: " + towns.length, 150, 200);
}