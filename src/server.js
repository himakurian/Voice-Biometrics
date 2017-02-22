// # Twilio & VoiceIt Demo

// This application demonstrates how Twilio integrates with the VoiceIt
// Voiceprint Portal, allowing for biometric authentication with your voice
// applications.

// Standard Operating Procedure
// -------------------------------

var twilio     = require('twilio'),
    SHA256     = require('crypto-js/sha256'),
    bodyParser = require('body-parser'),
    express    = require('express'),
    request    = require('request');

// Prepare the Express server and body parsing middleware.
var port = process.env.PORT || 1337;
var app = express();
app.use(bodyParser());

var VOICEIT_DEV_ID = process.env.VOICEIT_DEV_ID;

// Stubbing VoiceIt Profiles with Phone Numbers
// --------------------------------------------
// VoiceIt authentication requires an email address, so we will make a fake
// one for this caller using the response body posted from Twilio.
var callerCredentials = function(body) {
   // Twilio's `body.From` is the caller's phone number, so let's use it as
   // identifier in the VoiceIt profile. It also means, the authentication is
   // bound only to this phone number.
   return  {
     number   : body.From,
     email    : body.From + '@twiliobioauth.example.com',
     password : SHA256(body.From)
   };
};

// Accept Incoming Calls
// ---------------------
// We need to accept incoming calls from Twilio. The fully-qualified URL should
// be added to your Twilio account and publicly available.
app.post('/incoming_call', function(req, res) {
  var caller  = callerCredentials(req.body);
  var twiml   = new twilio.TwimlResponse();
  // Prepare options for the VoiceIt `GET /sivservice/api/users` API request.
  var options = {
    url: 'https://siv.voiceprintportal.com/sivservice/api/users',
    headers: {
      'VsitEmail'       : caller.email,
      'VsitPassword'    : caller.password,
      'VsitDeveloperId' : VOICEIT_DEV_ID,
      'PlatformID'      : '23'//Please IGNORE This Parameter Used Internally to gather Platform Analytics
    }
  };

  request(options, function (error, response,  body) {
    // When VoiceIt responds with at `200`, we know the user's account profile
    // exists in the VoiceIt system.
    if (!error && response.statusCode == 200) {
      var voiceIt = JSON.parse(body);

      // Greet the caller when their account profile is recognized by the VoiceIt API.
      twiml.say(
        'You have reached Intuits QuickBooks . Your phone number has been recognized in our system.'
      );
      // Let's provide the caller with an opportunity to enroll by typing `1` on
      // their phone's keypad.
      twiml.gather({
        action    : '/enroll_or_authenticate',
        numDigits : 1,
        timeout   : 3
      }, function () {
        this.say(
          'You can now log in, or press 1 now to enroll for the first time.'
        );
      });
      twiml.redirect('/enroll_or_authenticate?digits=TIMEOUT');

      res.send(twiml.toString());
    } else {
      switch(response.statusCode) {
        // Create a VoiceIt user when the HTTP status is `412 Precondition Failed`.
        case 412:
          // Prepare options for the VoiceIt `POST /sivservice/api/users` API request.
          var options = {
            url: 'https://siv.voiceprintportal.com/sivservice/api/users',
            headers: {
              'VsitDeveloperId' : VOICEIT_DEV_ID,
              'VsitEmail'       : caller.email,
              'VsitFirstName'   : 'First' + caller.number,
              'VsitLastName'    : 'Last' + caller.number,
              'VsitPassword'    : caller.password,
              'VsitPhone1'      : caller.number,
              'PlatformID'      : '23'//Please IGNORE This Parameter Used Internally to gather Platform Analytics
            }
          };

          request.post(options, function (error, response,  body) {
            if (!error && response.statusCode == 200) {
              var voiceIt = JSON.parse(body);
              console.log(voiceIt);
            } else {
              console.log(response.statusCode);
              console.log(body);
            }
          });

          twiml.say(
            'Welcome to Intuitis QuickBooks. Our system identifies you as a new user, ' +
            'you will now be taken through the enrollment process.'
          );
          // Then we'll want to send them immediately to enrollment.
          twiml.redirect({ digits: '1' }, '/enroll');

          res.send(twiml.toString());
          break;
        default:
          new Error('An unhandled error occured');
      }
    }
  });
});

// Routing Enrollments & Authentication
// ------------------------------------
// We need a route to help determine what the caller intends to do.
app.post('/enroll_or_authenticate', function(req, res) {
  var digits = req.body.Digits;
  var twiml  = new twilio.TwimlResponse();
  
  // When the caller asked to enroll by pressing `1`, provide friendly
  // instructions, otherwise, we always assume their intent is to authenticate.
  //twiml.say('You are in enroll or auth stub and we will continue the process until the code works fine');
  //var digits = numIn.replace(/[^0-9]/g, '');
  
  //console.log(JSON.stringify(req.body.Digits));
  //console.log(JSON.stringify(req.body.Digits).replace(/[^0-9]/g, ''));	
  //console.log(digits);
  if (digits == 1) {
    twiml.say(
      'You have chosen to create a new account with Intuits voice recognition system. You will be ' +
      'asked to say a phrase 3 times, then you will be able to log in with that phrase.'
    );
    twiml.redirect('/enroll');
  } else {
    twiml.redirect('/authenticate');
  }

  res.send(twiml.toString());
});

// Enrollments
// -----------
app.post('/enroll', function(req, res) {
  var enrollCount = req.query.enrollCount || 0;
  var twiml       = new twilio.TwimlResponse();

  twiml.say('Please say the following phrase to enroll.');
  twiml.pause(1);
  twiml.say('My voice is my secured password');
  twiml.record({
    action    : '/process_enrollment?enrollCount=' + enrollCount,
    maxLength : 5,
    trim      : 'do-not-trim'
  });

  res.send(twiml.toString());
});

app.post('/authenticate', function(req, res) {
  var twiml = new twilio.TwimlResponse();

  twiml.say('Please say the following phrase to authenticate. Once complete press the pound key.');
  twiml.pause(1);
  twiml.say('My voice is my secured password');
  // We neeed to record a `.wav` file. This will be sent to VoiceIt for authentication.
  twiml.record({
    action    : '/process_authentication',
    maxLength : '5',
    trim      : 'do-not-trim',
  });

  res.send(twiml.toString());
});

app.post('/process_enrollment', function(req, res) {
  var caller       = callerCredentials(req.body);
  var enrollCount  = req.query.enrollCount;
  var recordingURL = req.body.RecordingUrl + ".wav";
  // Prepare options for the VoiceIt `POST /sivservice/api/enrollments/bywavurl API request.
  var options      = {
    url: 'https://siv.voiceprintportal.com/sivservice/api/enrollments/bywavurl',
    headers: {
      'VsitDeveloperId' : VOICEIT_DEV_ID,
      'VsitEmail'       : caller.email,
      'VsitPassword'    : caller.password,
      'VsitwavURL'      : recordingURL,
      'PlatformID'      : '23'//Please IGNORE This Parameter Used Internally to gather Platform Analytics
    }
  };

  request.post(options, function (error, response, body) {
    var twiml = new twilio.TwimlResponse();

    if (!error && response.statusCode == 200) {
      var voiceIt = JSON.parse(body);

      if (voiceIt.Result == 'Success') {
        enrollCount++;
        // VoiceIt requires at least 3 successful enrollments.
        if (enrollCount > 2) {
          twiml.say(
            'Thank you, recording is recieved. You are now enrolled and would be redirected to log in.'
          );
          twiml.redirect('/authenticate');
        } else {
          twiml.say(
            'Thank you, recording is recieved. You will now be asked to record your phrase again.'
          );
          twiml.redirect('/enroll?enrollCount=' + enrollCount);
        }
      } else {
        twiml.say('Sorry, your recording did not go through. Please try again.');
        twiml.redirect('/enroll?enrollCount=' + enrollCount);
      }
    } else {
      twiml.say('Sorry, your recording did not go through. Please try again');
      twiml.redirect('/enroll?enrollCount=' + enrollCount);
    }

    res.send(twiml.toString());
  });
});


//Methods to be executed after successfull login
app.post('/options', function(req, res) {
  var twiml = new twilio.TwimlResponse();


  twiml.say('Select one of the option to proceed');
  twiml.pause(2);
  twiml.gather({
    action    : '/subOptions',
    numDigits : 1,
    timeout   : 3
   }, function () {
       this.say('Please press 1 for Quickbooks Online. Press 2 for Quickbooks Desktop');
    });
  twiml.redirect('/subOptions?digits=TIMEOUT');
  res.send(twiml.toString());
});

app.post('/subOptions', function(req,res) {
	var twiml = new twilio.TwimlResponse();
	
	var toneUrl = 'http://kamazoy.uk/wp-content/uploads/2013/03/012.wav';
	twiml.say('To purchase a new QuickBook press 1. For support press 2.');
	twiml.pause(2);
	twiml.say('A customer care executive will assist you shortly, please wait while we transfer your call. This call will be recorded and monitored for quality and training purposes.');
	twiml.play(toneUrl);
	res.send(twiml.toString());
});

//login methods ends here

app.post('/process_authentication', function(req, res) {
  var caller       = callerCredentials(req.body);
  var recordingURL = req.body.RecordingUrl + '.wav';
  var options      = {
    url: 'https://siv.voiceprintportal.com/sivservice/api/authentications/bywavurl',
    headers: {
      'VsitConfidence' : 89,
      'VsitDeveloperId': VOICEIT_DEV_ID,
      'VsitEmail'      : caller.email,
      'VsitPassword'   : caller.password,
      'VsitwavURL'     : recordingURL,
      'PlatformID'     : '23'//Please IGNORE This Parameter Used Internally to gather Platform Analytics
    }
  };

  request.post(options, function(error, response, body) {
    var twiml = new twilio.TwimlResponse();

    if (!error && response.statusCode == 200) {
      var voiceIt = JSON.parse(body);
      console.log(voiceIt);

      switch(voiceIt.ResponseCode) {
        case 'ATF':
          twiml.say('Your authentication did not pass. Please try again.');
          twiml.redirect('/authenticate');
          break;
	case 'SUC':
	  twiml.say('Great you are in now');
	  twiml.redirect('/options');
	  break;
	case 'VPND':
	  twiml.say('Voiceprint Phrase not detected. Please make sure Voiceprint Phrase is at least 1.2 seconds long.');
        default:
          twiml.say(voiceIt.Result);
      }
    } else {
      twiml.say('OOPS! Your authentication did not pass. Please try again.');
      twiml.redirect('/authenticate');

      new Error(response.statusCode, body);
    }

    res.send(twiml.toString());
  });
});

app.listen(port);
console.log('Running Voice Biometrics IVR Server on port ' + port);
