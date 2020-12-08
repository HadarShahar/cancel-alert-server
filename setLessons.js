/*****************************************************************************************
This code fetches all the lessons of each class in Rotberg high school from the api,
categorizes them and updates the data in firebase

*****************************************************************************************/

// load environment variables from .env file
require('dotenv').config();

const CLASSES_NUM = 10;
const ENGLISH_CLASSES = ["10th", "11th", "12th"];
const HEBREW_CLASSES = ["י", "יא", "יב"];
const CATEGORIES = [
    ["מתמטיקה"],
    ["פיסיקה", "כימיה", "ביולוגיה"],
    ["תכנות מונחה עצמים", "מעבדת מערכות מידע", "פרוייקט", "מבנה נתונים", "תכנות", "אסמבלי"],
    ["חנ\"ג", "אנגלית"],
    ["חינוך", "לשון", "תנ\"ך", "ספרות", "היסטוריה"],
    ["פרטני"],
    []
];

const fetch = require("node-fetch");
// shahaf's api parameters for Rotberg high school
const API_PARAMS = {
    semel: process.env.ROTBERG_API_SEMEL,
    code: process.env.ROTBERG_API_CODE,
    token: process.env.ROTBERG_API_TOKEN
};
const BASE_API_URL = `https://view.shahaf.info/api/student/${API_PARAMS.semel}/${API_PARAMS.code}`;

// export functions
module.exports = {
    setAllLessons
}


// node.js equivalent of python's if __name__ == '__main__'
if (require.main === module) {
    // the main function initializes the firebase app which should be initialized only once.
    // if this file is imported, the app is already initialized
    // therefore main is called only when this file is being run directly 
    main();
}


async function main() {
    // the firebase service account is a JSON configuration file saved at "privatekey.json" 
    // this code loads it from an environment variable as base64 encoded string and decodes it
    // const serviceAccount = require("./privatekey.json");
    const serviceAccount = JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('ascii'));
    const admin = require("firebase-admin");
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: "https://cancelalert-ee4e1.firebaseio.com/"
    });
    let db = admin.database();

    let allClassesID = await getAllClassesID();
    console.log(allClassesID);
    setAllLessons(allClassesID, db);
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


async function setAllLessons(allClassesID, db) {
    for (let i = 0; i < ENGLISH_CLASSES.length; i++) {
        let Class = ENGLISH_CLASSES[i];
        for (let ClassNumber = 1; ClassNumber <= CLASSES_NUM; ClassNumber++) {

            let classId = allClassesID[`${Class}_${ClassNumber}`];
            if (classId) { // undefind if the class doesn't exist
                await setLessonsForClass(classId, Class, ClassNumber, db);
            }
        }
    }
}


async function setLessonsForClass(classId, Class, ClassNumber, db) {
    // sample parameters: (12, "11th", 4, firebse object);
    console.log(`setLessonsForClass ${Class}_${ClassNumber}`);

    let dataType = "schedule";
    let api_schedule = `${BASE_API_URL}/${dataType}/?token=${API_PARAMS.token}&clsId=${classId}`;

    let data;
    try {
        const response = await fetch(api_schedule);
        data = await response.json();
    } catch (error) {
        console.log("setLessonsForClass() error:");
        console.log(error);
        return;
    }

    let allCategories = new Array(CATEGORIES.length);
    for (let i = 0; i < allCategories.length; i++) {
        allCategories[i] = [];
    }
    let savedLessons = [];

    let Schedule = data.Schedule;
    for (let i = 0; i < Schedule.length; i++) {
        for (let lesson of Schedule[i].Lessons) {
            let currentLesson = {
                teacher: lesson.Teacher,
                subject: lesson.Subject
            };
            let save = true;
            for (let savedLesson of savedLessons) {
                // if the lesson was already saved
                if (savedLesson.teacher == currentLesson.teacher &&
                    savedLesson.subject == currentLesson.subject) {
                    save = false;
                    break;
                }
            }
            if (save) {
                savedLessons.push(currentLesson);
                allCategories[getCategoryIndex(CATEGORIES, currentLesson)].push(currentLesson);
            }
        }
    }

    // saved categorized lessons to the database
    db.ref(`classes/${Class}_grade/${ClassNumber}/allCategories`).set(allCategories);
}


function getCategoryIndex(categories, currentLesson) {
    for (let i = 0; i < categories.length; i++) {
        for (let j = 0; j < categories[i].length; j++) {
            if (currentLesson.subject.includes(categories[i][j])) {
                return i;
            }
        }
    }
    return categories.length - 1;
}