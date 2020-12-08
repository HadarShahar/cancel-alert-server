# cancel-alert-server
This code is the backend of [the android app I wrote](https://github.com/HadarShahar/cancel-alert-app).

It constantly checks for changes in the schedule of each class in Rotberg high school
using the schedule changes company API, and updates them in firebase. 
If a lesson is canceled for a specific class, it sends a notification to all the 
class users through the app using Firebase Cloud Messaging.
It runs at heroku all the time (except for several hours at night, so I don't run out of my free dyno hours).
