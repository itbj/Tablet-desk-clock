/* 
 * Tablet desk clock
 * 
 * Copyright (c) 2015 Project Nayuki
 * All rights reserved. Contact Nayuki for licensing.
 * http://www.nayuki.io/page/tablet-desk-clock
 */

"use strict";


/**** Shared constants and functions ****/

// Useful Unicode characters
var DEGREE_CHAR      = "\u00B0";
var QUARTER_EM_SPACE = "\u2005";
var EN_SPACE         = "\u2002";
var EN_DASH          = "\u2013";
var MINUS_CHAR       = "\u2212";
var SUN_CHAR         = "\u263C";
var MOON_CHAR        = "\u263D";


// Returns a text node that should be the only child of the given DOM element.
// If the DOM element already has a text node child then it is returned; otherwise a new blank child is added and returned.
// The element must not have sub-elements or multiple text nodes.
function getChildTextNode(elemId) {
	var elem = document.getElementById(elemId);
	if (elem.firstChild == null || elem.firstChild.nodeType != Node.TEXT_NODE)
		elem.insertBefore(document.createTextNode(""), elem.firstChild);
	return elem.firstChild;
}


// Returns the given integer as an exactly two-digit string.
// e.g. twoDigits(0) -> "00", twoDigits(8) -> "08", twoDigits(52) -> "52".
function twoDigits(n) {
	if (typeof n != "number" || n < 0 || n >= 100 || Math.floor(n) != n)
		throw "Integer expected";
	return (n < 10 ? "0" : "") + n;
}


var timeOffset = 0;  // Server time minus client time, useful if client is a different machine and is inaccurate

// Returns the server's current time as a Date object.
function getCorrectedDatetime() {
	return new Date(Date.now() + timeOffset);
}

// Monkey patching
Date.prototype.clone = function() {
	return new Date(this.getTime());
};


// Calls the given function strictly at or after the given wakeup datetime (i.e. getCorrectedDatetime().getTime() >= wake.getTime()).
// The given function may be called immediately synchronously or asynchronously later.
function scheduleCall(func, wake) {
	var delay = wake.getTime() - getCorrectedDatetime().getTime();
	if (delay <= 0)
		func();
	else
		setTimeout(function() { scheduleCall(func, wake); }, delay);
}


// Performs an XHR on the given URL, and calls the given function with the parsed JSON data if data was successful obtained.
function getAndProcessJson(url, timeout, retryCount, func) {
	var xhr = new XMLHttpRequest();
	xhr.onload = function() {
		func(JSON.parse(xhr.response));
	};
	xhr.ontimeout = function() {
		if (retryCount < 9)  // Exponential back-off
			setTimeout(function() { getAndProcessJson(url, timeout, retryCount + 1, func); }, Math.pow(2, retryCount) * 1000);
	};
	xhr.open("GET", url, true);
	xhr.responseType = "text";
	xhr.timeout = timeout;
	xhr.send();
}


/**** Clock module ****/

var clockModule = new function() {
	// Private variables
	var secondsTextNode = new MemoizingTextNode("clock-seconds");
	var timeTextNode    = new MemoizingTextNode("clock-time");
	var utcTextNode     = new MemoizingTextNode("clock-utc");
	var dateTextNode    = new MemoizingTextNode("clock-date");
	var DAYS_OF_WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
	
	// Updates the date and time texts every second.
	function autoUpdateClockDisplay() {
		var d = getCorrectedDatetime();
		secondsTextNode.setText(twoDigits(d.getSeconds()));  // Local seconds: "19"
		timeTextNode   .setText(twoDigits(d.getHours()) + ":" + twoDigits(d.getMinutes()));  // Local time: "14:32"
		utcTextNode    .setText(twoDigits(d.getUTCDate()) + "-" + DAYS_OF_WEEK[d.getUTCDay()] + EN_SPACE + twoDigits(d.getUTCHours()) + ":" + twoDigits(d.getUTCMinutes()) + EN_SPACE + "UTC");  // UTC date/time: "15-Fri 18:32 UTC"
		dateTextNode   .setText(d.getFullYear() + EN_DASH + twoDigits(d.getMonth() + 1) + EN_DASH + twoDigits(d.getDate()) + EN_DASH + DAYS_OF_WEEK[d.getDay()]);  // Local date: "2015-05-15-Fri"
		d.setMilliseconds(1000);
		scheduleCall(autoUpdateClockDisplay, d);
	}
	
	// Updates the clock wallpaper once.
	var randomizeWallpaper = this.randomizeWallpaper = function () {
		getAndProcessJson("/random-wallpaper.json", 3000, 0, function(data) {
			if (typeof data == "string") {
				var clockElem = document.getElementById("clock");
				clockElem.style.backgroundImage = "linear-gradient(rgba(0,0,0,0.65),rgba(0,0,0,0.65)),url('wallpapers/" + data + "')"
			}
		});
	};
	
	// Updates the clock wallpaper at startup and thereafter every day at 05:00.
	function autoUpdateWallpaper() {
		randomizeWallpaper();
		
		// Schedule next update at 05:00 local time
		var now = getCorrectedDatetime();
		var next = now.clone();
		next.setHours(5);
		next.setMinutes(0);
		next.setSeconds(0);
		next.setMilliseconds(0);
		if (next.getTime() <= now.getTime())
			next.setDate(next.getDate() + 1);
		scheduleCall(autoUpdateWallpaper, next);
	}
	
	// Updates the server-versus-client time offset at startup only
	function updateTimeOffset() {
		getAndProcessJson("/time.json", 1000, 0, function(data) {
			if (typeof data == "number") {
				timeOffset = data - Date.now();
				if (Math.abs(timeOffset) < 50)  // Heuristic for detecting local server
					timeOffset = 0;  // Don't correct if source is local, because it's counter-productive
			}
		});
	}
	
	// A wrapper around a DOM text node to avoid pushing unnecessary value updates to the DOM.
	function MemoizingTextNode(elemId) {
		var textNode = getChildTextNode(elemId);
		var value = textNode.data;
		this.setText = function(str) {
			if (str != value) {
				textNode.data = str;
				value = str;
			}
		};
	}
	
	// Initialization
	autoUpdateClockDisplay();
	autoUpdateWallpaper();
	updateTimeOffset();
};


/**** Admin module ****/

var adminModule = new function() {
	// Toggles whether the admin pane is shown or hidden.
	this.togglePane = function() {
		var elem = document.getElementById("admin-content");
		elem.style.display = elem.style.display == "none" ? "block" : "none";
	};
	
	this.reloadWeather = function() {
		weatherModule.sunrisesetTextNode .data = "";
		weatherModule.conditionTextNode  .data = "";
		weatherModule.temperatureTextNode.data = "(Weather loading...)";
		weatherModule.doWeatherRequest();
	};
}


/**** Weather module ****/

var weatherModule = new function() {
	var sunrisesetTextNode  = this.sunrisesetTextNode  = getChildTextNode("morning-sunriseset");
	var conditionTextNode   = this.conditionTextNode   = getChildTextNode("clock-weather-condition");
	var temperatureTextNode = this.temperatureTextNode = getChildTextNode("clock-weather-temperature");
	var weatherTextIsSet;
	
	// Updates the weather display once.
	var doWeatherRequest = this.doWeatherRequest = function() {
		getAndProcessJson("/weather.json", 10000, 0, function(data) {
			if (typeof data != "object") {
				sunrisesetTextNode.data = "";
				temperatureTextNode.data = "";
				conditionTextNode.data = "(Weather: Data error)";
			} else {
				sunrisesetTextNode.data = SUN_CHAR + " " + data["sunrise"] + " ~ " + data["sunset"] + " " + MOON_CHAR;
				conditionTextNode.data = data["condition"];
				temperatureTextNode.data = Math.round(parseFloat(data["temperature"])).toString().replace("-", MINUS_CHAR) + QUARTER_EM_SPACE + DEGREE_CHAR + "C";
				var d = getCorrectedDatetime();
				getChildTextNode("admin-last-weather").data = twoDigits(d.getHours()) + ":" + twoDigits(d.getMinutes());
			}
			weatherTextIsSet = true;
		});
	}
	
	// Updates the weather and sunrise displays at startup and thereafter at around 4 minutes past each hour
	function autoUpdateWeather() {
		// Set delayed placeholder text
		weatherTextIsSet = false;
		setTimeout(function() {
			if (!weatherTextIsSet) {
				sunrisesetTextNode.data = "";
				temperatureTextNode.data = "";
				conditionTextNode.data = "(Weather loading...)"; }}, 3000);
		doWeatherRequest();
		
		// Schedule next update at about 5 minutes past the hour
		var now = getCorrectedDatetime();
		var next = now.clone();
		next.setMinutes(4);
		next.setSeconds(0);
		next.setMilliseconds(Math.random() * 2 * 60 * 1000);  // Deliberate jitter of 2 minutes
		if (next.getTime() < now.getTime() || next.getHours() == now.getHours() && now.getMinutes() >= 4)
			next.setHours(next.getHours() + 1);
		scheduleCall(autoUpdateWeather, next);
	}
	
	// Initialization
	autoUpdateWeather();
};


/**** Morning module ****/

var morningModule = new function() {
	var morningElem = document.getElementById("morning");
	var greetingSpans = morningElem.getElementsByTagName("h1")[0].getElementsByTagName("span");
	var remindersElem = document.getElementById("morning-reminders");
	
	function showMorning() {
		var msgIndex = Math.floor(Math.random() * greetingSpans.length);
		for (var i = 0; i < greetingSpans.length; i++)
			greetingSpans[i].style.display = i == msgIndex ? "inline" : "none";
		
		clearMessages();
		addMessage("(Loading...)");
		doMorningRequest();
		
		morningElem.style.display = "table";
		scheduleNextMorning();
		setTimeout(hideMorning, 5 * 3600 * 1000);
	}
	
	function hideMorning() {
		morningElem.style.display = "none";
		clearMessages();
	}
	
	function addMessage(text) {
		var li = document.createElement("li");
		li.appendChild(document.createTextNode(text));
		remindersElem.appendChild(li);
	}
	
	function clearMessages() {
		while (remindersElem.firstChild != null)
			remindersElem.removeChild(remindersElem.firstChild);
	}
	
	function doMorningRequest() {
		getAndProcessJson("/morning-reminders.json", 3000, 0, function(data) {
			if (typeof data != "object") {
				clearMessages();
				addMessage("(Error)");
			} else {
				clearMessages();
				var d = getCorrectedDatetime();
				var key = d.getFullYear() + (d.getMonth() + 1 < 10 ? "0" : "") + (d.getMonth() + 1) + (d.getDate() < 10 ? "0" : "") + d.getDate();
				if (key in data) {
					var msgs = data[key];
					if (msgs.length == 0)
						addMessage("(None)");
					else {
						for (var i = 0; i < msgs.length; i++)
							addMessage(msgs[i]);
					}
				} else
					addMessage("(Data missing)");
			}
		});
	}
	
	// Shows the morning data every day at 07:00
	function scheduleNextMorning() {
		var now = getCorrectedDatetime();
		var next = now.clone();
		next.setHours(7);
		next.setMinutes(0);
		next.setSeconds(0);
		next.setMilliseconds(0);
		if (next.getTime() < now.getTime())
			next.setDate(next.getDate() + 1);
		scheduleCall(showMorning, next);
	}
	
	// Initialization
	morningElem.onclick = hideMorning;
	scheduleNextMorning();
};
