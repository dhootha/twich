var CONFIG = { debug: false
             , nick: "#"   // set in onConnect
             , id: null    // set in onConnect
             , last_message_time: 1
             , focus: true //event listeners bound in onConnect
             , unread: 0 //updated in the message-processing loop
             };

var nicks = [];

//updates the users link to reflect the number of active users
function updateUsersLink () {
    var t = nicks.length.toString() + " user";
    if (nicks.length != 1) t += "s";
    $("#usersLink").text(t);
}



//handles another person joining chat
function userJoin(nick, timestamp) {
    //put it in the stream
    addMessage(nick, "joined", timestamp, "join");
    //if we already know about this user, ignore it
    for (var i = 0; i < nicks.length; i++) {
        if (nicks[i] == nick) return;
    }
    //otherwise, add the user to the list
    nicks.push(nick);
    //update the UI
    updateUsersLink();
}



//handles someone leaving
function userPart(nick, timestamp) {
    //put it in the stream
    addMessage(nick, "left", timestamp, "part");
    //remove the user from the list
    for (var i = 0; i < nicks.length; i++) {
        if (nicks[i] == nick) {
            nicks.splice(i,1);
            break;
        }
    }
    //update the UI
    updateUsersLink();
}



// utility functions
util = {
    urlRE: /https?:\/\/([-\w\.]+)+(:\d+)?(\/([^\s]*(\?\S+)?)?)?/g, 

    // html sanitizer 
    toStaticHTML: function(inputHtml) {
        inputHtml = inputHtml.toString();
        return inputHtml.replace(/&/g, "&amp;")
                        .replace(/</g, "&lt;")
                        .replace(/>/g, "&gt;");
    }, 

    //pads n with zeros on the left,
    //digits is minimum length of output
    //zeroPad(3, 5); returns "005"
    //zeroPad(2, 500); returns "500"
    zeroPad: function (digits, n) {
        n = n.toString();
        while (n.length < digits) 
          n = '0' + n;
        return n;
    },

    //it is almost 8 o'clock PM here
    //timeString(new Date); returns "19:49"
    timeString: function (date) {
        var minutes = date.getMinutes().toString();
        var hours = date.getHours().toString();
        return this.zeroPad(2, hours) + ":" + this.zeroPad(2, minutes);
    },

    //does the argument only contain whitespace?
    isBlank: function(text) {
        var blank = /^\s*$/;
        return (text.match(blank) !== null);
    }
};



//used to keep the most recent messages visible
function scrollDown () {
    $('#log').scrollTo('max');
    $("#entry").focus();
}



//inserts an event into the stream for display
//the event may be a msg, join or part type
//from is the user, text is the body and time is the timestamp, defaulting to now
//_class is a css class to apply to the message, usefull for system events
function addMessage (from, text, time, _class) {
    if (text === null) return;

    if (time == null) {
        // if the time is null or undefined, use the current time.
        time = new Date();
    } 
    else if ((time instanceof Date) === false) {
        // if it's a timestamp, interpret it
        time = new Date(time);
    }

    //every message you see is actually a table with 3 cols:
    //  the time,
    //  the person who caused the event,
    //  and the content
    var messageElement = $(document.createElement("table"));

    messageElement.addClass("message");
    if (_class) {
        messageElement.addClass(_class);
    }

    // sanitize
    text = util.toStaticHTML(text);

    // If the current user said this, add a special css class
    var nick_re = new RegExp(CONFIG.nick);
    if (nick_re.exec(text)) {
        messageElement.addClass("personal");
    }

    // replace URLs with links
    text = text.replace(util.urlRE, '<a target="_blank" href="$&">$&</a>');

    var content = '<tr>'
        + '  <td class="date">' + util.timeString(time) + '</td>'
        + '  <td class="nick">' + util.toStaticHTML(from) + '</td>'
        + '  <td class="msg-text">' + text  + '</td>'
        + '</tr>'
        ;
    messageElement.html(content);

    //the log is the stream that we view
    $("#log").append(messageElement);

    //always view the most recent message when it is added
    scrollDown();
}



var transmission_errors = 0;
var first_poll = true;


//process updates if we have any, request updates from the server,
// and call again with response. the last part is like recursion except the call
// is being made from the response handler, and not at some point during the
// function's execution.
function longPoll (data) {
    if (transmission_errors > 2) {
        showConnect();
        return;
    }

    //process any updates we may have
    //data will be null on the first call of longPoll
    if (data && data.messages) {
        for (var i = 0; i < data.messages.length; i++) {
            var message = data.messages[i];

            //track oldest message so we only request newer messages from server
            if (message.timestamp > CONFIG.last_message_time)
                CONFIG.last_message_time = message.timestamp;

            //dispatch new messages to their appropriate handlers
            switch (message.type) {
                case "msg":
                    if(!CONFIG.focus){
                        CONFIG.unread++;
                    }
                addMessage(message.nick, message.text, message.timestamp);
                break;

                case "join":
                    userJoin(message.nick, message.timestamp);
                break;

                case "part":
                    userPart(message.nick, message.timestamp);
                break;
            }
        }
        //update the document title to include unread message count if blurred
        updateTitle();

        //only after the first request for messages do we want to show who is here
        if (first_poll) {
            first_poll = false;
            who();
        }
    }

    //make another request
    $.ajax({ 
        cache: false
        , type: "GET"
        , url: CONFIG.node_url + "/recv?jp=?"
        , dataType: "json"
        , data: { since: CONFIG.last_message_time, room: CONFIG.room, id: CONFIG.id }
        , error: function () {
            addMessage("", "long poll error. trying again...", new Date(), "error");
            transmission_errors += 1;
            //don't flood the servers on error, wait 10 seconds before retrying
            setTimeout(longPoll, 10*1000);
          }
        , success: function (data) {
            transmission_errors = 0;
            //if everything went well, begin another request immediately
            //the server will take a long time to respond
            //how long? well, it will wait until there is another message
            //and then it will return it to us and close the connection.
            //since the connection is closed when we get data, we longPoll again
            longPoll(data);
          }
    });
}



//submit a new message to the server
function send(msg) {
    if (CONFIG.debug === false) {
        // XXX should be POST
        // XXX should add to messages immediately
        jQuery.get(CONFIG.node_url + "/send?jp=?", {id: CONFIG.id, room: CONFIG.room, text: msg}, function (data) { }, "json");
    }
}



//Transition the page to the state that prompts the user for a nickname
function showConnect () {
    $("#connect").show();
    $("#loading").hide();
    $("#toolbar").hide();
    $("#nickInput").focus();
}



//transition the page to the loading screen
function showLoad () {
    $("#connect").hide();
    $("#loading").show();
    $("#toolbar").hide();
}



//transition the page to the main chat view, putting the cursor in the textfield
function showChat (nick) {
    $("#toolbar").show();
    $("#entry").focus();

    $("#connect").hide();
    $("#loading").hide();
    $('#log').show();

    scrollDown();
}



function resizeLog() {
    var newHeight = $(window).height() - 100;
    $('#log').css('height',newHeight + "px");
}



//we want to show a count of unread messages when the window does not have focus
function updateTitle() {
    if (CONFIG.unread) {
        document.title = "(" + CONFIG.unread.toString() + ") twich.me/"+CONFIG.room;
    } 
    else {
        document.title = "twich.me/"+CONFIG.room;
    }
}



//handle the server's response to our nickname and join request
function onConnect (session) {
    if (session.error) {
        alert("error connecting: " + session.error);
        showConnect();
        return;
    }
    longPoll();

    CONFIG.nick = session.nick;
    CONFIG.id   = session.id;

    //update the UI to show the chat
    showChat(CONFIG.nick);
    //addMessage('twichEvent', 'Masterchef twich tonight at 7.30PM http://twich.me/masterchef',null,'notice');

    //listen for browser events so we know to update the document title
    $(window).bind("blur", function() {
            CONFIG.focus = false;
            updateTitle();
            });

    $(window).bind("focus", function() {
            CONFIG.focus = true;
            CONFIG.unread = 0;
            updateTitle();
            });
}



//add a list of present chat members to the stream
function outputUsers () {
    var nick_string = nicks.length > 0 ? nicks.join(", ") : "(none)";
    addMessage("users:", nick_string, new Date(), "notice");
    return false;
}



//get a list of the users presently in the room, and add it to the stream
function who () {
    jQuery.ajax({ cache: false
                , type: "GET"
                , dataType: "json"
                , url: CONFIG.node_url + "/who?jp=?"
                , data: {nick: CONFIG.nick, room: CONFIG.room}
                , success: function(session) {
                    nicks = session.nicks;
                    outputUsers();
                }
    });

}



$(document).ready(function() {

    if((navigator.userAgent.match(/iPhone/i)) || (navigator.userAgent.match(/iPod/i))) { 
        $('#entry').css('width','80%');
        $('#entry-btn').css('width','9%').css('display','inline');
    }

    //submit new messages when the user hits enter if the message isnt blank
    $("#entry").keypress(function (e) {
        if (e.keyCode != 13 /* Return */) return;
        var msg = $("#entry").attr("value").replace("\n", "");
        if (!util.isBlank(msg)) send(msg);
        $("#entry").attr("value", ""); // clear the entry field.
    });

    $("#entry-btn").click(function () {
        var msg = $("#entry").attr("value").replace("\n", "");
        if (!util.isBlank(msg)) send(msg);
        $("#entry").attr("value", ""); // clear the entry field.
    });

    $("#usersLink").click(outputUsers);

    //try joining the chat when the user clicks the connect button
    $("#connectButton").click(function () {
        //lock the UI while waiting for a response
        showLoad();
        var nick = $("#nickInput").attr("value");

        //dont bother the backend if we fail easy validations
        if (nick.length > 50) {
            alert("Nick too long. 50 character max.");
            showConnect();
            return false;
        }

        //more validations
        if (/[^\w_\-^!]/.exec(nick)) {
            alert("Bad character in nick. Can only have letters, numbers, and '_', '-', '^', '!'");
            showConnect();
            return false;
        }

        //make the actual join request to the server
        $.ajax({ cache: false
               , type: "GET" // XXX should be POST
               , dataType: "json"
               , url: CONFIG.node_url + "/join?jp=?"
               , data: { nick: nick , room: CONFIG.room}
               , error: function (session) {
                   alert("error " + session.error);
                   showConnect();
                 }
               , success: onConnect
               });
        return false;
    });

    // update the clock every second
    setInterval(function () {
        var now = new Date();
        $("#currentTime").text(util.timeString(now));
    }, 1000);

    resizeLog();
    if (CONFIG.debug) {
        $("#loading").hide();
        $("#connect").hide();
        scrollDown();
        return;
    }

    // remove fixtures
    $("#log table").remove();

    //begin listening for updates right away
    //interestingly, we don't need to join a room to get its updates
    //we just don't show the chat stream to the user until we create a session
    //longPoll();

    showConnect();
    //showChat();
});

//if we can, notify the server that we're going away.
$(window).unload(function () {
    jQuery.get(CONFIG.node_url + "/part?jp=?", {id: CONFIG.id}, function (data) { }, "json");
});

$(window).bind('resize',function() {
    resizeLog();
});
