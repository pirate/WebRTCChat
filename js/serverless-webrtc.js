function WebRTCChat(cfg, con, myKeyPair, usePGP, theyUsePGP, sendTyping) {
    var self = this;

/* WebRTC setup for broser-to-browser connection */
    self.cfg = {'iceServers':[]}; //{"url":"stun:23.21.150.121"}
    self.con = {'optional':  [{'DtlsSrtpKeyAgreement': true}] };
    self.activeChannel;
    self.activeConnection;
    self.roomName;

/* OpenPGP setup for chat encryption */
    self.myKeyPair = null;
    self.theirPubKey = "";
    self.readystate = false;
    self.usePGP = true;
    self.theyUsePGP = true;
    self.pgpStrength = 512;
    self.sendTyping = true;

/* WebRTC + PGP CHAT CONNECTION CODE */

    self.initConnection = function(conn, callback) {
        self.activeConnection = conn;
        self.myKeyPair = openpgp.generateKeyPair({numBits:self.pgpStrength,userId:"1",passphrase:"",unlocked:true});
        conn.onconnection                   = function (state) {console.info('Chat connection complete: ', event);}
        conn.onsignalingstatechange         = function (state) {console.info('Signaling state change: ', state); if (self.activeConnection.iceConnectionState == "disconnected") self.writeToChatLog("Chat partner disconnected.", "text-warning");}
        conn.oniceconnectionstatechange     = function (state) {console.info('Signaling ICE connection state change: ', state); if (self.activeConnection.iceConnectionState == "disconnected") self.writeToChatLog("Chat partner disconnected.", "text-warning");}
        conn.onicegatheringstatechange      = function (state) {console.info('Signaling ICE setup state change: ', state);}
        conn.onicecandidate = function (event) {
            // when browser has determined how to connect, generate offer or answer with ICE connection details and PGP public key
            if (event.candidate == null) {
                console.log("Valid ICE connection candidate determined.");
                var offer_or_answer = JSON.stringify({
                    rtc: self.activeConnection.localDescription,
                    pgpKey: self.myKeyPair.publicKeyArmored,
                    encryption: self.usePGP,
                    roomName: self.roomName
                });
                // pass the offer or answer to the callback for display to the user or sending over a communication channel
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

    self.sendTypingMessage = function() {
        self.activeChannel.send(JSON.stringify({message:null,typing:true,encrypted:false}));
    }

    self.sendMessage = function(message, encrypted) {
        if (Boolean(encrypted)) {
            self.activeChannel.send(JSON.stringify({message: self.PGPencrypt(message), encrypted:true}));
            self.writeToChatLog(message, "text-success sent secure", true);
        }
        else {
            self.activeChannel.send(JSON.stringify({message: message, encrypted:false}));
            self.writeToChatLog(message, "text-success sent insecure", false);
        }
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
                if (data.encrypted) self.writeToChatLog(self.PGPdecrypt(data.message), "text-info recv", true);
                else self.writeToChatLog(data.message, "text-info recv", false);
            }
        }
    }

    self.PGPdecrypt = function(message) {
        pgpMessage = openpgp.message.readArmored(message);
        return openpgp.decryptMessage(self.myKeyPair.key, pgpMessage);
    }

    self.PGPencrypt = function(message) {
        return openpgp.encryptMessage(self.theirPubKey.keys, message);
    }

/* THE HOST (initiated the chat) */

    self.hostChat = function(offer_callback, ready_callback) {
        var hostConnection = new RTCPeerConnection(self.cfg, self.con);
        self.initConnection(hostConnection, offer_callback);
        var hostChannel = hostConnection.createDataChannel('test', {reliable:true});
        self.initChannel(hostChannel, ready_callback);
        
        console.log("Creating RTC Chat Host Offer...");
        hostConnection.createOffer(self.handleDescription, self.handleDescriptionFailure);
        // copy paste this offer to all clients who want to join
        // they paste their answer back, which goes into handleAnswerFromClient
    }

    self.handleAnswerFromClient = function(answer) {
        if (answer.pgpKey) {
            self.theirPubKey = openpgp.key.readArmored(answer.pgpKey);
            console.log("Received Chat Partner's Public PGP Key: ", answer.pgpKey);
        }
        self.theyUsePGP = Boolean(answer.encryption);

        var answerDesc = new RTCSessionDescription(answer.rtc);
        console.log("Received Chat RTC Join Answer: ", answerDesc);
        self.activeConnection.setRemoteDescription(answerDesc);

        writeToChatLog("Started hosting a chat.", "text-success");

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
            writeToChatLog("Joined a chat.", "text-success");
            // clientChannel.onopen will then trigger once the connection is complete (enabling the chat window)
        };

        if (offer.pgpKey) {
            self.theirPubKey = openpgp.key.readArmored(offer.pgpKey);
            console.log("Received Chat Partner's Public PGP Key: ", offer.pgpKey);
        }
        self.theyUsePGP = Boolean(offer.encryption);
        self.roomName = offer.roomName;

        var offerDesc = new RTCSessionDescription(offer.rtc);
        console.log("Received Chat RTC Host Offer: ", offerDesc);
        self.activeConnection.setRemoteDescription(offerDesc);
        
        console.log("Answering Chat Host Offer...");
        self.activeConnection.createAnswer(self.handleDescription, self.handleDescriptionFailure);

        // ondatachannel triggers once the client has accepted our answer ^
    }

/* Utilities */

    self.writeToChatLog = function(message, message_type, secure) {
        console.log("-> ", message, message_type, secure);
    }

    self.displayPartnerTyping = function() {
        console.log("-> Typing...")
    }

    self.lzw_encode = function(s) {
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

    self.lzw_decode = function(s) {
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

}
