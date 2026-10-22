# EduVerse (Phase II)

A game-style virtual campus. Log in, walk with W/A/S/D straight through a classroom door (no key press, no new page).

## Run
    npm install
    npm start
Open http://localhost:3000

## Demo accounts
- student1 / student123, student2 / student123
- Faculty IDs 1516 to 1523 (password = ID), one assigned room each: 1516 CS201, 1517 CS202, 1518 CS203, 1519 CS204, 1520 CS205, 1521 MA201, 1522 CS206, 1523 CS207

## API 
- POST /api/login  -> token, role, room, rooms, spawn (401 on wrong password)
- GET  /api/me     -> needs `x-token` header (401 if missing/wrong)
- POST /api/logout -> needs `x-token` header

## C++ (simple, separate for now)
    cd cpp
    g++ main.cpp -o eduverse && ./eduverse
Shows OOP (User/Student/Faculty/Room) and data structures (vector, map, queue).
It is not connected to Node.js yet (planned for a later phase).

## Roles
- Student: starts in the hall and can walk into any room.
- Faculty: starts inside their own room and stays there (doorway is closed for them).

## Note
Passwords are in plain text in data.json for now; hashing is planned.
