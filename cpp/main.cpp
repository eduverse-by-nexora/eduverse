// EduVerse - simple C++ program
// Topics shown: classes, inheritance, virtual function, array, queue
//
// How to run:
//   g++ main.cpp -o eduverse
//   ./eduverse

#include <iostream>   // for cout (printing on screen)
#include <string>     // for string (text)
#include <queue>      // for queue (first come, first served line)
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
    // Constructor: runs when a User is created, saves the name
    User(string n)
    {
        name = n;
    }

    // Destructor: runs when the object is removed (needed for virtual classes)
    virtual ~User() {}

    // Returns the person's name
    string getName()
    {
        return name;
    }

    // "= 0" means: User does not define the role itself.
    // Student and Faculty MUST write their own role().
    virtual string role() = 0;
};


// Student is a "child" of User (it gets name and getName for free)
class Student : public User
{
public:
    Student(string n) : User(n) {}        // send the name up to User

    string role()
    {
        return "student";
    }
};


// Faculty is also a "child" of User
class Faculty : public User
{
private:
    string room;                          // the one room this faculty teaches in

public:
    Faculty(string n, string r) : User(n)
    {
        room = r;
    }

    string role()
    {
        return "faculty";
    }

    string getRoom()
    {
        return room;
    }
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
    // Make a new empty room (count starts at 0)
    Room(string n = "")
    {
        name = n;
        count = 0;
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
        // Step 1: look for the person
        for (int i = 0; i < count; i++)
        {
            if (members[i] == user)
            {
                // Step 2: found! Move everyone after them one place left
                //         (this fills the empty gap)
                for (int j = i; j < count - 1; j++)
                {
                    members[j] = members[j + 1];
                }

                // Step 3: one less person inside
                count--;
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
    // Create two rooms
    Room pythonRoom("Python");
    Room javaRoom("Java");

    // Create one faculty and two students
    Faculty f("Faculty Python", "Python");
    Student s1("Student One");
    Student s2("Student Two");

    // One list that holds all three people.
    // A User pointer can point to a Student or a Faculty.
    User *people[] = { &f, &s1, &s2 };

    // Print each person's name and role.
    // role() is virtual, so each object gives its OWN answer.
    for (User *u : people)
    {
        cout << u->getName() << " is a " << u->role() << endl;
    }

    // QUEUE: students waiting in line to enter a room.
    // First one in the line is the first one served.
    queue<string> requests;
    requests.push(s1.getName());          // Student One joins the line
    requests.push(s2.getName());          // Student Two joins the line

    // The faculty enters first, but only into their own room
    if (f.getRoom() == "Python")
    {
        pythonRoom.enter(f.getName());
    }
    else
    {
        pythonRoom.enter("");
    }

    // Let the students in, one by one, in the order they asked
    while (!requests.empty())
    {
        pythonRoom.enter(requests.front());   // look at the first student
        requests.pop();                       // remove them from the line
    }

    // Show both rooms
    pythonRoom.show();
    javaRoom.show();

    // Student One leaves the Python room, then show it again
    pythonRoom.leave(s1.getName());
    pythonRoom.show();

    return 0;
}