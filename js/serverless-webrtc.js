function WebRTCChat(cfg, con, sendTyping) {
    var self = this;

/* WebRTC setup for broser-to-browser connection */
    self.cfg = {'iceServers':[{"url":"stun:23.21.150.121"}]}; //{"url":"stun:23.21.150.121"}
    self.con = {'optional':  [{'DtlsSrtpKeyAgreement': true}] };
    self.activeChannel;
    self.activeConnection;
    self.roomName;

    self.readystate = false;
    self.sendTyping = true;

/* WebRTC + PGP CHAT CONNECTION CODE */

    /* THE HOST (initiates the chat) */

    self.hostChat = function(offer_callback, ready_callback) {
        var hostConnection = new RTCPeerConnection(self.cfg, self.con);                                 // init connection
        self.initConnection(hostConnection, offer_callback);

        var hostChannel = hostConnection.createDataChannel('chat', {reliable:true, ordered:true});      // init channel
        self.initChannel(hostChannel, ready_callback);
        
        console.log("Creating RTC Chat Host Offer...");
        hostConnection.createOffer(self.handleDescription, self.handleDescriptionFailure);
        // copy paste this offer to all clients who want to join
        // they paste their answer back, which goes into handleAnswerFromClient
    }

    self.handleAnswerFromClient = function(answer) {
        var answerDesc = new RTCSessionDescription(answer.rtc);
        console.log("Received Chat RTC Join Answer: ", answerDesc);
        self.activeConnection.setRemoteDescription(answerDesc);

        writeToChatLog("Started hosting a chat.", "text-success alert-success");

        // hostChannel.onopen will trigger once the connection is complete (enabling the chat window)
    }

    /* THE JOINEE (joins an existing chat) */

    self.joinChat = function(offer, answer_callback, ready_callback) {
        var clientConnection = new RTCPeerConnection(cfg, con);
        self.initConnection(clientConnection, answer_callback);

        clientConnection.ondatachannel = function (e) {                                     // once client receives a good data channel from the host
            // Chrome sends event, FF sends raw channel
            var clientChannel = e.channel || e;
            self.initChannel(clientChannel, ready_callback);
            writeToChatLog("Joined a chat.", "text-success alert-success");
            // clientChannel.onopen will then trigger once the connection is complete (enabling the chat window)
        };

        self.roomName = offer.roomName;

        var offerDesc = new RTCSessionDescription(offer.rtc);
        console.log("Received Chat RTC Host Offer: ", offerDesc);
        self.activeConnection.setRemoteDescription(offerDesc);
        
        console.log("Answering Chat Host Offer...");
        self.activeConnection.createAnswer(self.handleDescription, self.handleDescriptionFailure);

        // ondatachannel triggers once the client has accepted our answer ^
    }

    self.initConnection = function(conn, callback) {
        self.activeConnection = conn;
        // these aren't really necessary
        conn.addStream(window.myStream);
        conn.onconnection                   = function (state) {console.info('Chat connection complete: ', event);}
        conn.onsignalingstatechange         = function (state) {console.info('Signaling state change: ', state); if (self.activeConnection.iceConnectionState == "disconnected") self.writeToChatLog("Chat partner disconnected.", "text-warning alert-error");}
        conn.oniceconnectionstatechange     = function (state) {console.info('Signaling ICE connection state change: ', state); if (self.activeConnection.iceConnectionState == "disconnected") self.writeToChatLog("Chat partner disconnected.", "text-warning alert-error");}
        conn.onicegatheringstatechange      = function (state) {console.info('Signaling ICE setup state change: ', state);}
        conn.onaddstream = function (event) {
            var video = document.getElementById('theirVideo');
            if (window.URL) video.src = window.URL.createObjectURL(event.stream);
            else video.src = event.stream;
            console.log("YAAAAAAAAgotvideo");
        }
        //this is the important one
        conn.onicecandidate = function (event) {
            // when browser has determined how to form a connection, generate offer or answer with ICE connection details and PGP public key
            if (event.candidate == null) {
                console.log("Valid ICE connection candidate determined.");
                var offer_or_answer = JSON.stringify({
                    rtc: self.activeConnection.localDescription,
                    roomName: self.roomName
                });
                // pass the offer or answer to the callback for display to the user or to send over some other communication channel
                if (callback) callback(offer_or_answer);
            }
        };
        conn.onfailure = function(details) {callback(details)};
        console.log("Initialized Connection: ", conn);
    }

    self.initChannel = function(chan, callback) {
        self.activeChannel = chan;
        // once the channel is open, trigger the callback to enable the chat window or carry out other logic
        chan.onopen = function (e) { console.log('Data Channel Connected.'); self.readystate = true; if (callback) callback(e);}
        chan.onmessage = self.receiveMessage;
        console.log("Initialized Data Channel: ", chan);
    }

    self.handleDescription = function(desc) {
        self.activeConnection.setLocalDescription(desc, function () {});
    }

    self.handleDescriptionFailure = function() {
        console.warn("Failed to create or answer chat offer.");
        self.activeConnection.onfailure("Invalid or expired chat offer. Please try again.")
    }

    // messaging functions

    self.sendTypingMessage = function() {
        self.activeChannel.send(JSON.stringify({message:null,typing:true}));
    }

    self.sendMessage = function(message) {
        self.activeChannel.send(JSON.stringify({message: message}));
        self.writeToChatLog(message, "text-success sent insecure", false);
    }

    self.receiveMessage = function(event) {
        var data = JSON.parse(event.data);
        if (data.type === 'file' || event.data.size) console.log("Receiving a file.");
        else {
            if (data.typing && !data.message) {
                console.log("Partner is typing...");
                self.displayPartnerTyping();
            }
            else {
                console.log("Received a message: ", data.message);
                self.writeToChatLog(data.message, "text-info recv", false);
            }
        }
    }

/* Utilities */

    // set these to your own functions using WebRTCChat.writeToChatLog = function(...) {...}

    self.writeToChatLog = function(message, message_type, secure) {console.log("-> ", message, message_type, secure);}

    self.displayPartnerTyping = function() {console.log("-> Typing...");}
}
