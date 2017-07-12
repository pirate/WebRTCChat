console.log('Confirm that this sends no outside network requests in the Network Panel.')

var receiveProgress = document.getElementById('receiveProgress')
var sendProgress = document.getElementById('sendProgress')
var bitrateDiv = document.getElementById('bitrate')
var statusMessage = document.getElementById('status')
var downloadsAnchor = document.getElementById('downloads')
var theirVideo = document.getElementById('theirVideo')
var myVideo = document.getElementById('myVideo')

function WebRTCChat(cfg, con, sendTyping) {
    var self = this;

/* WebRTC setup for broser-to-browser connection */
    self.cfg = {'iceServers':[{
      'url': 'stun:stun.l.google.com:19302'
    }]}; //{"url":"stun:23.21.150.121"}
    self.con = {'optional':  [{'DtlsSrtpKeyAgreement': true}] };
    self.activeChannel;
    self.activeConnection;
    self.roomName;

    self.readystate = false;
    self.sendTyping = true;

/* WebRTC + CHAT CONNECTION CODE */

    /* THE HOST (initiates the chat) */

    self.hostChat = function(offer_callback, ready_callback) {
        var hostConnection = new RTCPeerConnection(self.cfg, self.con);                                 // init connection
        self.initConnection(hostConnection, offer_callback);

        self.initVideo();

        var hostChannel = hostConnection.createDataChannel('chat', {
            reliable: true,
            ordered: true,
        });
        self.initChannel(hostChannel, ready_callback);

        console.log("Creating RTC Chat Host Offer...");
        hostConnection.createOffer(
            self.handleDescription,
            self.handleDescriptionFailure,
            {offerToReceiveAudio: true, offerToReceiveVideo: true}
        );
        // copy paste this offer to all clients who want to join
        // they paste their answer back, which goes into handleAnswerFromClient
    }

    self.handleAnswerFromClient = function(answer) {
        var answerDesc = new RTCSessionDescription(answer.rtc);
        console.log("Received Chat RTC Join Answer: ", answerDesc);
        self.activeConnection.setRemoteDescription(answerDesc);
        self.activeChannel.onopen()
        writeToChatLog("Started hosting a chat.", "text-success alert-success");

        // hostChannel.onopen will trigger once the connection is complete (enabling the chat window)
    }

    /* THE JOINEE (joins an existing chat) */

    self.joinChat = function(offer, answer_callback, ready_callback) {
        var clientConnection = new RTCPeerConnection(cfg, con);
        self.initConnection(clientConnection, answer_callback);

        self.activeConnection.ondatachannel = function (e) {                                     // once client receives a good data channel from the host
            // Chrome sends event, FF sends raw channel
            var clientChannel = e.channel || e;
            self.initChannel(clientChannel, ready_callback);
            self.activeChannel.onopen()
            writeToChatLog("Joined a chat.", "text-success alert-success");
            // clientChannel.onopen will then trigger once the connection is complete (enabling the chat window)
        };

        self.roomName = offer.roomName;

        var offerDesc = new RTCSessionDescription(offer.rtc);
        console.log("Received Chat RTC Host Offer: ", offerDesc);
        self.activeConnection.setRemoteDescription(offerDesc);

        console.log("Answering Chat Host Offer...");
        self.activeConnection.createAnswer(
            self.handleDescription,
            self.handleDescriptionFailure,
            {offerToReceiveAudio: true, offerToReceiveVideo: true}
        );

        // ondatachannel triggers once the client has accepted our answer ^
    }

    self.initConnection = function(conn, callback) {
        self.activeConnection = conn;
        // these aren't really necessary
        conn.onconnection                   = function (state) {console.info('Chat connection complete: ', event);}
        conn.onsignalingstatechange         = function (state) {console.info('Signaling state change: ', state); if (self.activeConnection.iceConnectionState == "disconnected") self.writeToChatLog("Chat partner disconnected.", "text-warning alert-error");}
        conn.oniceconnectionstatechange     = function (state) {console.info('Signaling ICE connection state change: ', state); if (self.activeConnection.iceConnectionState == "disconnected") self.writeToChatLog("Chat partner disconnected.", "text-warning alert-error");}
        conn.onicegatheringstatechange      = function (state) {console.info('Signaling ICE setup state change: ', state);}
        conn.onaddstream = function (event) {
            var video = theirVideo;
            if (window.URL)
                video.src = window.URL.createObjectURL(event.stream);
            else
                video.src = event.stream;
            console.log("You got their video!");
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
        self.activeChannel.binaryType = 'arraybuffer';
        // once the channel is open, trigger the callback to enable the chat window or carry out other logic
        self.activeChannel.onopen = function (e) {
            console.log('Data Channel Connected.');
            self.readystate = true;
            if (callback) callback(e);
        }
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
        try {
            var data = JSON.parse(event.data);
        } catch(e) {
            console.log('RECEIVING FILE')
            return self.receiveFile(event);
        }

        if (data.file) {
            return self.prepareToReceiveFile(data);
        }

        if (data.typing && !data.message) {
            console.log("Partner is typing...");
            self.displayPartnerTyping();
        }
        else {
            console.log("Received a message: ", data.message);
            self.writeToChatLog(data.message, "text-info recv", false);
        }
    }

    // Audio and Video

    self.initVideo = function() {
        navigator.getUserMedia = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia;
        var video = myVideo;

        navigator.getUserMedia({
            audio: false,
            video: true
        }, function (stream) {
          if (window.URL)
            video.src = window.URL.createObjectURL(stream);
          else
            video.src = stream;
          window.myStream = stream;
          self.activeConnection.addStream(window.myStream);
            // self.activeChannel.send(JSON.stringify({
            //     message: "Started sharing video."
            // }));
            self.writeToChatLog(
                "Started sharing video.",
                "text-success sent insecure", false);
        }, function (error){
          console.log('navigator.getUserMedia error: ', error);
        });
    }

    // Files

    self.prepareToReceiveFile = function(data) {
        self.startTime = null;
        self.receiveBuffer = null;
        self.receivedSize = null;
        self.bitrateMax = null;
        self.numReceivedFiles = self.numReceivedFiles || 0;
        self.receivedFiles = self.receivedFiles || {};
        self.writeToChatLog(
            "Receiving " + data.name + " (" + data.size + " bytes)",
            "text-success sent insecure",
            false
        );
        self.numReceivedFiles += 1;
        // XSS out the wazoo
        var downloadLink = downloadsAnchor.innerHTML += (
            '<li>'
            + 'Download: <a href="#" download="' + data.name + '" id="recvd-' + self.numReceivedFiles + '">' + data.name + '</a>'
            + " (" + data.size + " bytes)"
            + '</li>'
        )
        self.receivedFiles[data.name] = data;
        self.receivedFiles[data.name].id = self.numReceivedFiles;
        self.receivedFiles[data.name].anchor = document.getElementById('recvd-' + self.numReceivedFiles);
        self.incomingFile = self.receivedFiles[data.name]
    }

    self.receiveFile = function(event) {
        self.startTime = self.startTime || (new Date).getTime();
        self.receiveBuffer = self.receiveBuffer || [];
        self.receivedSize = self.receivedSize || 0;
        self.bitrateMax = self.bitrateMax || 0;

        self.receiveBuffer.push(event.data);
        self.receivedSize += event.data.byteLength;

        receiveProgress.value = self.receivedSize;

        // we are assuming that our signaling protocol told
        // about the expected file size (and name, hash, etc).
        var received = new window.Blob(self.receiveBuffer);
        self.receiveBuffer = [];

        var url = URL.createObjectURL(received);
        self.incomingFile.anchor.href = url;

        var bitrate = Math.round(self.receivedSize * 8 /
            ((new Date()).getTime() - self.startTime));

        if (bitrate > self.bitrateMax) {
            self.bitrateMax = bitrate;
        }

        bitrateDiv.innerHTML = '<strong>Bitrate:</strong> ' +
            bitrate + ' kbits/sec (max: ' + self.bitrateMax + ' kbits/sec)';

        if (self.receivedSize >= self.incomingFile.size) {
            self.writeToChatLog(
                "Receiving " + self.incomingFile.name + " finished! Download it below.",
                "text-success sent insecure",
                false
            );
            self.activeChannel.send(JSON.stringify({
                message: 'Received ' + self.incomingFile.name + " succesfully.",
            }));
        } else {
            self.incomingFile.anchor.disabled = true;
        }
    }

    self.sendFile = function(files) {
        var file = [].concat.apply([], files).slice(-1)[0];
        console.log('File is ' + [file.name, file.size, file.type,
            file.lastModifiedDate
        ].join(' '));
        self.activeChannel.send(JSON.stringify({
            file: true,
            name: file.name,
            size: file.size,
        }));
        self.writeToChatLog("Sending " + file.name, "text-success sent insecure", false);

        // Handle 0 size files.
        statusMessage.textContent = '';
        if (file.size === 0) {
          bitrateDiv.innerHTML = '';
          statusMessage.textContent = 'File is empty, please select a non-empty file';
          return;
        }
        sendProgress.max = file.size;
        receiveProgress.max = file.size;
        var chunkSize = 16384;
        var sliceFile = function(offset) {
          var reader = new window.FileReader();
          reader.onload = (function() {
            return function(e) {
              self.activeChannel.send(e.target.result);
              if (file.size > offset + e.target.result.byteLength) {
                window.setTimeout(sliceFile, 0, offset + chunkSize);
              }
              sendProgress.value = offset + e.target.result.byteLength;
            };
          })(file);
          var slice = file.slice(offset, offset + chunkSize);
          reader.readAsArrayBuffer(slice);
        };
        sliceFile(0);
    }

/* Utilities */

    // set these to your own functions using WebRTCChat.writeToChatLog = function(...) {...}

    self.writeToChatLog = function(message, message_type, secure) {console.log("-> ", message, message_type, secure);}

    self.displayPartnerTyping = function() {console.log("-> Typing...");}
}
