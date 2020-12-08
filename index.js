/*****************************************************************************************
This code constantly checks for changes in the schedule of each class in Rotberg 
high school using the api, and updates them in firebase. 
If a lesson is canceled for a specific class, it sends a notification to all the 
class users through the android app "שינויי מערכת רוטברג".

It runs at http://cancel-alert-server.herokuapp.com/

to run the file:
    node index.js
    (if it doesn't work run: node --tls-min-v1.0 index.js)
to manage heroku config vars:
    heroku config
    heroku config:set VAR=VALUE
*****************************************************************************************/

// load environment variables from .env file
require('dotenv').config();

const CLASSES_NUM = 10;
const ENGLISH_CLASSES = ["10th", "11th", "12th"];
const HEBREW_CLASSES = ["י", "יא", "יב"];
const lessonsStartTimes = [
    "7:45", "8:30", "9:15", "10:15", "11:00", "12:10", "12:55", "13:55",
    "14:40", "15:35", "16:20", "17:05", "17:50", "18:35", "19:20"
];


const fetch = require("node-fetch");
// shahaf's api parameters for Rotberg high school
const API_PARAMS = {
    semel: process.env.ROTBERG_API_SEMEL,
    code: process.env.ROTBERG_API_CODE,
    token: process.env.ROTBERG_API_TOKEN
};
const BASE_API_URL = `https://view.shahaf.info/api/student/${API_PARAMS.semel}/${API_PARAMS.code}`;


// the firebase service account is a JSON configuration file saved at "privatekey.json" 
// this code loads it from an environment variable as base64 encoded string and decodes it
// const serviceAccount = require("./privatekey.json");
const serviceAccount = JSON.parse(
    Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('ascii')
);
const fcm = require("fcm-notification"); // Firebase Cloud Messaging 
const FCM = new fcm(serviceAccount);
const admin = require("firebase-admin");
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://cancelalert-ee4e1.firebaseio.com/"
});
let db = admin.database();


const express = require('express');
const app = express();
app.set('port', (process.env.PORT || 5000));
app.use(express.static('client'));
app.listen(app.get('port'), function () {
    console.log('Node app is running on port', app.get('port'));
});


main();


async function main() {
    let allClassesID = await getAllClassesID();
    console.log(allClassesID);

    // update the ids in the database
    for (let ClassName in allClassesID) {
        // sample ClassName: '10th_4'
        let [Class, ClassNumber] = ClassName.split('_');
        db.ref(`classes/${Class}_grade/${ClassNumber}/classId`).set(allClassesID[ClassName]);
    }

    // update all the lessons in the databse (divided into categories)
    const setLessons = require("./setLessons.js");
    await setLessons.setAllLessons(allClassesID, db);

    let minutesStartTimes = [];
    for (let i = 0; i < lessonsStartTimes.length; i++) {
        let [hour, minute] = lessonsStartTimes[i].split(":");
        // 3 hours back for Heroku
        minutesStartTimes.push(parseInt(hour) * 60 + parseInt(minute) - 3 * 60);
    }

    checkAllClasses(allClassesID, minutesStartTimes);
}


async function checkAllClasses(allClassesID, minutesStartTimes) {
    while (true) {
        for (let i = 0; i < ENGLISH_CLASSES.length; i++) {
            let Class = ENGLISH_CLASSES[i];

            for (let ClassNumber = 1; ClassNumber <= CLASSES_NUM; ClassNumber++) {
                console.log(Class + "_" + ClassNumber);
                try {
                    let classId = allClassesID[Class + "_" + ClassNumber];
                    if (classId) { // undefind if the class doesn't exist
                        await updateCurrentNextLesson(classId, Class, ClassNumber, minutesStartTimes);
                        await getDataFromAPI(classId, Class, ClassNumber);
                    }
                } catch (error) {
                    console.log("checkAllClasses() error:");
                    console.log(error);
                }
            }
        }
    }
}


async function getAllClassesID() {
    let allClassesID = {};

    let dataType = "classes";
    let classes_api = `${BASE_API_URL}/${dataType}/?token=${API_PARAMS.token}`;
    let data;
    try {
        const response = await fetch(classes_api);
        data = await response.json();
    } catch (error) {
        console.log("getAllClassesID() error:");
        console.log(error);
        return;
    }
    let Classes = data.Classes; // array of all the classes in the school (and more irrelevant groups)

    for (let i = 0; i < ENGLISH_CLASSES.length; i++) {
        let Class = ENGLISH_CLASSES[i];

        for (let ClassNumber = 1; ClassNumber <= CLASSES_NUM; ClassNumber++) {
            let hebrewClassName = HEBREW_CLASSES[i] + ClassNumber.toString();

            for (let i = 0; i < Classes.length; i++) {
                if (Classes[i].Name == hebrewClassName) { // if it's a relevant class, save its id
                    allClassesID[Class + "_" + ClassNumber] = Classes[i].Id;
                    break;
                }
            }
        }
    }
    return allClassesID;
}


async function updateCurrentNextLesson(classId, Class, ClassNumber, minutesStartTimes) {
    let currentDate = new Date();
    let currentMinTime = currentDate.getHours() * 60 + currentDate.getMinutes();

    let currentLessonHour = null;
    let nextLessonHour = null;
    for (let i = 0; i < minutesStartTimes.length - 1; i++) {
        if (currentMinTime >= minutesStartTimes[i] && currentMinTime < minutesStartTimes[i + 1]) {
            currentLessonHour = i;
            nextLessonHour = i + 1;
            break;
        }
    }
    if (currentLessonHour == null) {
        return;
    }

    let dataType = "schedule";
    let api_schedule = `${BASE_API_URL}/${dataType}/?token=${API_PARAMS.token}&clsId=${classId}`;
    let data;
    try {
        const response = await fetch(api_schedule);
        data = await response.json();
    } catch (error) {
        console.log("updateCurrentNextLesson() error:");
        console.log(error);
        return;
    }

    let currentLesson = [];
    let nextLesson = [];
    let Schedule = data.Schedule;
    for (let i = 0; i < Schedule.length; i++) {
        if (Schedule[i].Day == currentDate.getDay()) {
            if (Schedule[i].Hour == currentLessonHour) {
                currentLesson = Schedule[i].Lessons;
            }
            if (Schedule[i].Hour == nextLessonHour) {
                nextLesson = Schedule[i].Lessons;
            }
            if (currentLesson.length > 0 && nextLesson.length > 0) {
                break;
            }
        }
    }

    db.ref("classes/" + Class + "_grade/" + ClassNumber + "/currentLesson").set(currentLesson);
    db.ref("classes/" + Class + "_grade/" + ClassNumber + "/nextLesson").set(nextLesson);
    db.ref("classes/currentLessonHour").set(currentLessonHour);
}


async function getDataFromAPI(classId, Class, ClassNumber) {
    let classRef = db.ref("classes/" + Class + "_grade/" + ClassNumber);
    let changesInDB = [];
    await classRef.once("value", function (snapshot) {
        if (snapshot.hasChild("changes")) {
            changesInDB = snapshot.child("changes").val();
        }
    });


    // let topicName = 'class_10th_4';
    let topicName = "class_" + Class + "_" + ClassNumber;
    let dataType = "changes";
    let api_url = `${BASE_API_URL}/${dataType}/?token=${API_PARAMS.token}&clsId=${classId}`;


    let classData;
    try {
        const response = await fetch(api_url);
        classData = await response.json();
    } catch (error) {
        console.log("getDataFromAPI() error:");
        console.log(error);
        return;
    }


    console.log(new Date().toLocaleTimeString(), classData);

    let saveChangesToDB = [];
    let allChanges = classData.Changes;
    for (let i = 0; i < allChanges.length; i++) {
        if (allChanges[i].ChangeType == 'FreeLesson') {
            saveChangesToDB.push({
                date: allChanges[i].Date,
                hour: allChanges[i].Hour,
                teacher: allChanges[i].StudyGroup.Teacher,
                subject: allChanges[i].StudyGroup.Subject
            });
            let sendNotification = true;
            for (let j = 0; j < changesInDB.length; j++) {
                if (changesInDB[j].date == allChanges[i].Date &&
                    changesInDB[j].hour == allChanges[i].Hour) {
                    sendNotification = false;
                    break;
                }
            }
            if (sendNotification) {
                let date = allChanges[i].Date;
                date = date.replace("/Date(", "");
                date = date.replace(")/", "");
                let newDate = new Date(parseInt(date));
                let finalDate = pad(newDate.getDate()) + '.' + pad((newDate.getMonth() + 1)) + '.' + newDate.getFullYear();

                let teacher = allChanges[i].StudyGroup.Teacher;
                let subject = allChanges[i].StudyGroup.Subject;

                let message = {
                    data: {
                        title: "ביטול " + subject + ", " + teacher,
                        body: finalDate + ", " + "שיעור " + allChanges[i].Hour
                    },
                    topic: topicName
                };
                await sendNotifications(message); //----last change
            }

        }
    }
    // classRef.set({
    //     changes: saveChangesToDB,
    //     currentNum: saveChangesToDB.length
    // });
    classRef.child("changes").set(saveChangesToDB); 
    classRef.child("currentNum").set(saveChangesToDB.length);

}


function sendNotifications(message) {
    FCM.send(message, function (err, response) {
        if (err) {
            console.log('error found', err);
        } else {
            console.log('response here', response);
        }
    });
}

function pad(str) {
    if (parseInt(str) < 10) {
        return "0" + str;
    }
    return str;
}






// just for testing (send me a message when I change my class in the app)
db.ref("users2").child(process.env.MY_APP_TOKEN).on("child_changed", function (snapshot) {
        let message = {
            data: {
                title: "You have just changed your class",
                body: snapshot.val(),
                everyone: "true" // because it's not in my classes list
            },
            token: process.env.MY_APP_TOKEN
        };
        sendNotifications(message);
    },
    function (errorObject) {
        console.log("The read failed: " + errorObject.code);
    });

// async function sendMsgToEveryone() {
//     for (let i = 0; i < ENGLISH_CLASSES.length; i++) {
//         let Class = ENGLISH_CLASSES[i];
//         for (let ClassNumber = 1; ClassNumber <= CLASSES_NUM; ClassNumber++) {
//             let topicName = "class_" + Class + "_" + ClassNumber;
//             console.log(topicName);
//             let message = {
//                 data: {
//                     title: "עדכון בחנות!!!",
//                     body: "סוף סוף אפשר לבחור מגמות",
//                     everyone: "true"
//                 },
//                 topic: topicName
//             };
//             await sendNotifications(message);
//         }
//     }
// }