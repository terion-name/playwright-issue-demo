* install with yarn
* start redis server
* run `node index.js` — `========== LOADED` will print
* halt and run it again — `========== LOADED` will not print

# UPD

problem was in response code type (string vs int). type casting fixes the issue. archiving
