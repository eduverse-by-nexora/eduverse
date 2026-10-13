// EduVerse C++ core (simple version)
// Shows OOP (classes, inheritance, virtual function)
// and data structures (vector, map, queue).
// Build: g++ main.cpp -o eduverse
// Run:   ./eduverse

#include <iostream>
#include <string>
#include <vector>
#include <map>
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
    vector<string> members; // data structure: vector
public:
    Room(string n = "") : name(n) {}
    void enter(string user) { members.push_back(user); }
    void leave(string user)
    {
        for (size_t i = 0; i < members.size(); i++)
        {
            if (members[i] == user)
            {
                members.erase(members.begin() + i);
                return;
            }
        }
    }
    void show()
    {
        cout << name << " (" << members.size() << " inside):";
        for (string m : members)
            cout << " " << m;
        cout << endl;
    }
};

int main()
{
    // data structure: map from room name to Room
    map<string, Room> rooms;
    rooms["Python"] = Room("Python");
    rooms["Java"] = Room("Java");

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

    rooms["Python"].enter(f.getRoom() == "Python" ? f.getName() : "");
    while (!requests.empty())
    {
        rooms["Python"].enter(requests.front());
        requests.pop();
    }
    rooms["Python"].show();
    rooms["Java"].show();

    rooms["Python"].leave(s1.getName());
    rooms["Python"].show();
    return 0;
}
