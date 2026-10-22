// EduVerse C++ core (simple version)
// Shows OOP (classes, inheritance, virtual function)
// and data structures (array, queue).
// Build: g++ main.cpp -o eduverse
// Run:   ./eduverse

#include <iostream>
#include <string>
#include <queue>
using namespace std;

// ---------- OOP: User, Student, Faculty ----------
class User
{
protected:
    string name;

public:
    User(string n) : name(n) {}
    virtual ~User() {}
    string getName() { return name; }
    virtual string role() = 0; // each subclass gives its own role
};

class Student : public User
{
public:
    Student(string n) : User(n) {}
    string role() { return "student"; }
};

class Faculty : public User
{
    string room; // one room per faculty
public:
    Faculty(string n, string r) : User(n), room(r) {}
    string role() { return "faculty"; }
    string getRoom() { return room; }
};

// ---------- Room: keeps a list of who is inside ----------
class Room
{
    string name;
    string members[50]; // data structure: simple array
    int count;          // how many people are inside
public:
    Room(string n = "") : name(n), count(0) {}
    void enter(string user)
    {
        members[count] = user;
        count++;
    }
    void leave(string user)
    {
        for (int i = 0; i < count; i++)
        {
            if (members[i] == user)
            {
                // shift everyone after it one step left
                for (int j = i; j < count - 1; j++)
                    members[j] = members[j + 1];
                count--;
                return;
            }
        }
    }
    void show()
    {
        cout << name << " (" << count << " inside):";
        for (int i = 0; i < count; i++)
            cout << " " << members[i];
        cout << endl;
    }
};

int main()
{
    // one Room object for each room
    Room pythonRoom("Python");
    Room javaRoom("Java");

    Faculty f("Faculty Python", "Python");
    Student s1("Student One");
    Student s2("Student Two");
    User *people[] = {&f, &s1, &s2};

    for (User *u : people)
        cout << u->getName() << " is a " << u->role() << endl;

    // data structure: queue of students asking to enter a room
    queue<string> requests;
    requests.push(s1.getName());
    requests.push(s2.getName());

    pythonRoom.enter(f.getRoom() == "Python" ? f.getName() : "");
    while (!requests.empty())
    {
        pythonRoom.enter(requests.front());
        requests.pop();
    }
    pythonRoom.show();
    javaRoom.show();

    pythonRoom.leave(s1.getName());
    pythonRoom.show();
    return 0;
}