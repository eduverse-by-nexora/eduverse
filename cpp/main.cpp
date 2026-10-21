// EduVerse - simple C++ program
// Topics shown: classes, inheritance, virtual function, array, queue
//
// How to run:
//   g++ main.cpp -o eduverse
//   ./eduverse

#include <iostream>   // cout (print on screen)
#include <string>     // string (text)
#include <queue>      // queue (first come, first served line)
using namespace std;


// =====================================================
// PART 1: USERS  (OOP - classes and inheritance)
// =====================================================

// User is the "parent" class. Every person in EduVerse is a User.
class User
{
protected:
    string name;                          // the person's name

public:
    User(string n) { name = n; }          // constructor: saves the name
    virtual ~User() {}                    // destructor (needed for virtual classes)

    string getName() { return name; }

    // "= 0" means: User does not write role() itself.
    // Student and Faculty MUST write their own role().
    virtual string role() = 0;
};

// Student is a "child" of User (it gets name and getName for free)
class Student : public User
{
public:
    Student(string n) : User(n) {}        // send the name up to User
    string role() { return "student"; }
};

// Faculty is also a "child" of User
class Faculty : public User
{
private:
    string room;                          // the one room this faculty teaches in

public:
    Faculty(string n, string r) : User(n) { room = r; }
    string role() { return "faculty"; }
    string getRoom() { return room; }
};


// =====================================================
// PART 2: ROOM  (keeps a list of who is inside)
// =====================================================

class Room
{
private:
    string name;                          // room name, e.g. "Python"
    string members[50];                   // ARRAY: can hold up to 50 names
    int count;                            // how many people are inside right now

public:
    Room(string n = "")
    {
        name = n;
        count = 0;                        // a new room is empty
    }

    // Add a person at the end of the list
    void enter(string user)
    {
        members[count] = user;
        count++;
    }

    // Remove a person from the list
    void leave(string user)
    {
        for (int i = 0; i < count; i++)
        {
            if (members[i] == user)
            {
                // found! move everyone after them one place left
                for (int j = i; j < count - 1; j++)
                {
                    members[j] = members[j + 1];
                }
                count--;                  // one less person inside
                return;                   // done, stop searching
            }
        }
    }

    // Print the room name, the number of people and their names
    void show()
    {
        cout << name << " (" << count << " inside):";
        for (int i = 0; i < count; i++)
        {
            cout << " " << members[i];
        }
        cout << endl;
    }
};


// =====================================================
// PART 3: MAIN  (where the program starts)
// =====================================================

int main()
{
    // Two rooms
    Room pythonRoom("Python");
    Room javaRoom("Java");

    // One faculty and two students
    Faculty f("Faculty Python", "Python");
    Student s1("Student One");
    Student s2("Student Two");

    // A User pointer can point to a Student or a Faculty.
    // role() is virtual, so each object gives its OWN answer.
    User *people[] = { &f, &s1, &s2 };
    for (User *u : people)
    {
        cout << u->getName() << " is a " << u->role() << endl;
    }

    // QUEUE: students waiting in line. First in line is served first.
    queue<string> requests;
    requests.push(s1.getName());
    requests.push(s2.getName());

    // The faculty enters first, but only into their own room
    if (f.getRoom() == "Python")
    {
        pythonRoom.enter(f.getName());
    }

    // Let the students in, in the order they asked
    while (!requests.empty())
    {
        pythonRoom.enter(requests.front());
        requests.pop();
    }

    pythonRoom.show();
    javaRoom.show();

    // Student One leaves, then show again
    pythonRoom.leave(s1.getName());
    pythonRoom.show();

    return 0;
}