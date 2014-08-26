/* WebRTC setup for broser-to-browser connection */
window.cfg = {'iceServers':[]}; //{"url":"stun:23.21.150.121"}
window.con = {'optional':  [{'DtlsSrtpKeyAgreement': true}] };
window.activeChannel;
window.activeConnection;

/* OpenPGP setup for chat encryption */
window.myKeyPair = null;
window.theirPubKey = "";
window.readystate = false;
window.usePGP = true;
window.theyUsePGP = true;
window.pgpStrength = 512;
window.sendTyping = true;

/* DOM INTERACTION CODE */

$('#showLocalOffer').modal('hide');
$('#getRemoteAnswer').modal('hide');
$('#waitForConnection').modal('hide');
$('#createOrJoin').modal('show');

/* User interactions to host a chat */

$('#createBtn').click(function() {
    window.pgpStrength = parseInt($('#pgpStrength').val()) || 512;
    window.usePGP = Boolean(parseInt($('#pgpStrength').val()));
    window.sendTyping = $('#sendTyping').is(':checked');
    $('#hostChat').modal('show');
    hostChat(function (offer_desc) {
        $('#offer').html(offer_desc);
        $('#answer').keyup(function(e) {
            if ($('#answer').val()) {
                var answer = JSON.parse($('#answer').val());
                $('#hostChat').remove();
                $('.modal-backdrop').remove();
                $('#waitForConnection').modal('show');
                handleAnswerFromClient(answer);
            }
        });
    }, displayChatReady);
});

/* User interactions to join a chat  */

$('#joinBtn').click(function() {
    window.pgpStrength = parseInt($('#pgpStrength').val()) || 512;
    window.usePGP = Boolean(parseInt($('#pgpStrength').val()));
    window.sendTyping = $('#sendTyping').is(':checked');
    $('#joinChat').modal('show');
    $('#offerFromHost').keyup(function(e) {
        if ($('#offerFromHost').val()) {
            var offer = JSON.parse($('#offerFromHost').val());
            joinChat(offer, function(answer_desc) {
                $('#answerToHost').html(answer_desc);
            }, displayChatReady);
        }
    });
});

$('#messageTextBox').keydown(function() {
    if (window.sendTyping) {
        sendTypingMessage();
        window.sendTyping = false;
        setTimeout(function() {
            window.sendTyping = true;
        }, 1000);
    }
});

/* used both when joining and hosting */

function displayChatReady() {
    $('#joinChat').remove();
    $('#waitForConnection').remove();
    $('.modal-backdrop').remove();
    $('#messageTextBox').focus();
    if (window.usePGP && !window.theyUsePGP) writeToChatLog("WARNING: You chose to enable PGP, but your chat partner did not.  Your messages will be sent encrypted but your partner's responses will come back in plain text.", "text-warning");
    else if (!window.usePGP) writeToChatLog("WARNING: You did not choose to enable PGP.  Your messages will be sent in plain text.", "text-warning");
    $('#sendMessageBtn').addClass('btn-primary');
}

function sendChatboxMessage() {
    if ($('#messageTextBox').val()) {
        sendMessage($('#messageTextBox').val(), window.usePGP);
        $('#messageTextBox').val('')
    }
    return false;
}

function writeToChatLog(message, message_type, secure) {
    $('.typing').remove();
    var img;
    if (window.usePGP == window.theyUsePGP || secure == undefined) img = '';
    else if (secure) img = '<img class="secure-icon" src="img/lock.png" width="10px">';
    else if (!secure) img = '<img class="insecure-icon" src="img/unlock.png" width="10px">';

    document.getElementById('chatlog').innerHTML += img + '<p class="msg ' + message_type + '">[' + getTimestamp() + '] ' + message + '</p><br>';
    $('#chatlog').scrollTop($('#chatlog')[0].scrollHeight);
}

function displayPartnerTyping() {
    if (!$('.typing').length) document.getElementById('chatlog').innerHTML += '<p class=\"text-info\ typing">' + "[" + getTimestamp() + "] ...</p>";
    else $('.typing').html("[" + getTimestamp() + "] ...");
    setTimeout(function() {
      $('.typing').remove();
    }, 2000);
}

/* WebRTC + PGP CHAT CONNECTION CODE */

function initConnection(conn, callback) {
    window.myKeyPair = openpgp.generateKeyPair({numBits:window.pgpStrength,userId:"1",passphrase:"",unlocked:true});
    console.log("Initialized Connection: ", conn);
    window.activeConnection = conn;
    conn.onconnection                   = function (state) {console.info('Chat connection complete: ', event);}
    conn.onsignalingstatechange         = function (state) {console.info('Signaling state change: ', state); if (activeConnection.iceConnectionState == "disconnected") writeToChatLog("Chat partner disconnected.", "text-warning");}
    conn.oniceconnectionstatechange     = function (state) {console.info('Signaling ICE connection state change: ', state); if (activeConnection.iceConnectionState == "disconnected") writeToChatLog("Chat partner disconnected.", "text-warning");}
    conn.onicegatheringstatechange      = function (state) {console.info('Signaling ICE setup state change: ', state);}
    conn.onicecandidate = function (event) {
        // when browser has determined how to connect, generate offer or answer with ICE connection details and PGP public key
        if (event.candidate == null) {
            console.log("Valid ICE connection candidate determined.");
            var offer_or_answer = JSON.stringify({
                rtc: window.activeConnection.localDescription,
                pgpKey: window.myKeyPair.publicKeyArmored,
                encryption: window.usePGP
            });
            // pass the offer or answer to the callback for display to the user or sending over a communication channel
            if (callback) callback(offer_or_answer);
        }
    };
    conn.onfailure = function(details) {callback(details)};
}

function initChannel(chan, callback) {
    console.log("Initialized Data Channel: ", chan);
    window.activeChannel = chan;
    // once the channel is open, trigger the callback to enable the chat window or carry out other logic
    chan.onopen = function (e) { console.log('Data Channel Connected.'); window.readystate = true; if (callback) callback();}
    chan.onmessage = receiveMessage;
}

function handleDescription(desc) {
    activeConnection.setLocalDescription(desc, function () {});
}

function handleDescriptionFailure() {
    console.warn("Failed to create or answer chat offer.");
    activeConnection.onfailure("Invalid or expired chat offer. Please try again.")
}

function sendTypingMessage() {
    activeChannel.send(JSON.stringify({message:null,typing:true,encrypted:false}));
}

function sendMessage(message, encrypted) {
    if (Boolean(encrypted)) {
        activeChannel.send(JSON.stringify({message: encrypt(message), encrypted:true}));
        writeToChatLog(message, "text-success sent secure", true);
    }
    else {
        activeChannel.send(JSON.stringify({message: message, encrypted:false}));
        writeToChatLog(message, "text-success sent insecure", false);
    }
}

function receiveMessage(event) {
    var data = JSON.parse(event.data);
    if (data.type === 'file' || event.data.size) console.log("Receiving a file.");
    else {
        if (data.typing && !data.message) {
            console.log("Partner is typing...");
            displayPartnerTyping();
        }
        else {
            console.log("Received a message: ", data.message);
            if (data.encrypted) writeToChatLog(decrypt(data.message), "text-info recv", true);
            else writeToChatLog(data.message, "text-info recv", false);
        }
    }
}

function decrypt(message) {
    pgpMessage = openpgp.message.readArmored(message);
    return openpgp.decryptMessage(window.myKeyPair.key, pgpMessage);
}

function encrypt(message) {
    return openpgp.encryptMessage(window.theirPubKey.keys, message);
}

/* THE HOST (initiated the chat) */

window.hostConnection = null;
window.hostChannel = null;

function hostChat(offer_callback, ready_callback) {
    hostConnection = new RTCPeerConnection(cfg, con);
    initConnection(hostConnection, offer_callback);
    hostChannel = hostConnection.createDataChannel('test', {reliable:true});
    initChannel(hostChannel, ready_callback);
    
    console.log("Creating RTC Chat Host Offer...");
    hostConnection.createOffer(handleDescription, handleDescriptionFailure);
    // copy paste this offer to all clients who want to join
    // they paste their answer back, which goes into handleAnswerFromClient
}

function handleAnswerFromClient(answer) {
    if (answer.pgpKey) {
        window.theirPubKey = openpgp.key.readArmored(answer.pgpKey);
        console.log("Received Chat Partner's Public PGP Key: ", answer.pgpKey);
    }
    window.theyUsePGP = Boolean(answer.encryption);

    var answerDesc = new RTCSessionDescription(answer.rtc);
    console.log("Received Chat RTC Join Answer: ", answerDesc);
    hostConnection.setRemoteDescription(answerDesc);

    writeToChatLog("Started hosting a chat.", "text-success");

    // hostChannel.onopen will trigger once the connection is complete (enabling the chat window)
}

/* THE JOINEE (joins an existing chat) */

window.clientConnection = null;
window.clientChannel = null;

function joinChat(offer, answer_callback, ready_callback) {
    clientConnection = new RTCPeerConnection(cfg, con);
    initConnection(clientConnection, answer_callback);

    clientConnection.ondatachannel = function (e) {                                     // once client receives a good data channel from the host
        var datachannel = e.channel || e;                                               // Chrome sends event, FF sends raw channel
        clientChannel = datachannel;
        initChannel(clientChannel, ready_callback);
        writeToChatLog("Joined a chat.", "text-success");
        // clientChannel.onopen will then trigger once the connection is complete (enabling the chat window)
    };

    if (offer.pgpKey) {
        window.theirPubKey = openpgp.key.readArmored(offer.pgpKey);
        console.log("Received Chat Partner's Public PGP Key: ", offer.pgpKey);
    }
    window.theyUsePGP = Boolean(offer.encryption);

    var offerDesc = new RTCSessionDescription(offer.rtc);
    console.log("Received Chat RTC Host Offer: ", offerDesc);
    clientConnection.setRemoteDescription(offerDesc);
    
    console.log("Answering Chat Host Offer...");
    clientConnection.createAnswer(handleDescription, handleDescriptionFailure);

    // ondatachannel triggers once the client has accepted our answer ^
}

/* Utilities */

function getTimestamp() {
    var totalSec = new Date().getTime() / 1000;
    var hours = parseInt(totalSec / 3600) % 24;
    var minutes = parseInt(totalSec / 60) % 60;
    var seconds = parseInt(totalSec % 60);

    return (hours < 10 ? "0" + hours : hours) + ":" +
           (minutes < 10 ? "0" + minutes : minutes) + ":" +
           (seconds  < 10 ? "0" + seconds : seconds);
}

function lzw_encode(s) {
    var dict = {};
    var data = (s + "").split("");
    var out = [];
    var currChar;
    var phrase = data[0];
    var code = 256;
    for (var i=1; i<data.length; i++) {
        currChar=data[i];
        if (dict[phrase + currChar] != null) {
            phrase += currChar;
        }
        else {
            out.push(phrase.length > 1 ? dict[phrase] : phrase.charCodeAt(0));
            dict[phrase + currChar] = code;
            code++;
            phrase=currChar;
        }
    }
    out.push(phrase.length > 1 ? dict[phrase] : phrase.charCodeAt(0));
    for (var i=0; i<out.length; i++) {
        out[i] = String.fromCharCode(out[i]);
    }
    return out.join("");
}

function lzw_decode(s) {
    var dict = {};
    var data = (s + "").split("");
    var currChar = data[0];
    var oldPhrase = currChar;
    var out = [currChar];
    var code = 256;
    var phrase;
    for (var i=1; i<data.length; i++) {
        var currCode = data[i].charCodeAt(0);
        if (currCode < 256) {
            phrase = data[i];
        }
        else {
           phrase = dict[currCode] ? dict[currCode] : (oldPhrase + currChar);
        }
        out.push(phrase);
        currChar = phrase.charAt(0);
        dict[code] = oldPhrase + currChar;
        code++;
        oldPhrase = phrase;
    }
    return out.join("");
}
