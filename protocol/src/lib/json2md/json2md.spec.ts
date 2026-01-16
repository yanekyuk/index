import { json2md } from './json2md';

console.log("🧪 Testing json2md Utility...\n");

// Test 1: Lists
console.log("1️⃣  Test: Lists");
const listItems = ["Apple", "Banana", "Cherry"];
const unorderedList = json2md.list(listItems);
const orderedList = json2md.list(listItems, true);

console.log("Unordered:\n" + unorderedList);
console.log("Ordered:\n" + orderedList);

if (unorderedList.includes("- Apple") && orderedList.includes("1. Apple")) {
    console.log("✅ Lists passed");
} else {
    console.error("❌ Lists failed");
}

// Test 2: Tables
console.log("\n2️⃣  Test: Tables");
const tableData = [
    { id: 1, name: "Alice", role: "Dev" },
    { id: 2, name: "Bob", role: "Designer" },
];
const table = json2md.table(tableData, {
    columns: [
        { header: "ID", key: "id" },
        { header: "User Name", key: "name" },
        { header: "Role", key: "role" }
    ]
});

console.log(table);

if (table.includes("| ID | User Name | Role |") && table.includes("| 1 | Alice | Dev |")) {
    console.log("✅ Tables passed");
} else {
    console.error("❌ Tables failed");
}

// Test 3: Nested Objects (fromObject)
console.log("\n3️⃣  Test: Nested Objects");
const profileData = {
    userId: "123",
    identity: {
        name: "Alice",
        bio: "Engineer"
    },
    attributes: {
        interests: ["Coding", "Hiking"]
    }
};

const md = json2md.fromObject(profileData, 2);
console.log(md);

/*
Expected:
**userId**: 123
## Identity
**name**: Alice
**bio**: Engineer
## Attributes
**interests**:
 - Coding
 - Hiking
*/

if (
    md.includes("**userId**: 123") &&
    md.includes("## Identity") &&
    md.includes("**name**: Alice") &&
    md.includes("## Attributes") &&
    md.includes("- Coding")
) {
    console.log("✅ Nested Objects passed");
} else {
    console.error("❌ Nested Objects failed");
}

// Test 4: Full User Profile (Complex)
console.log("\n4️⃣  Test: Full User Profile");
const fullProfile = {
    userId: "user-xyz",
    identity: {
        name: "Full User",
        bio: "Complex Bio",
        location: "Metaverse",
        links: ["https://example.com"]
    },
    attributes: {
        interests: ["AI", "Crypto"],
        skills: ["TypeScript", "Python"],
        goals: [] // Empty array
    },
    narrative: {
        context: "Long context string..."
    }
};

const profileMd = json2md.keyValue(fullProfile);
console.log(profileMd);

if (
    profileMd.includes("**userId**: user-xyz") &&
    profileMd.includes("## Identity") &&
    profileMd.includes("- https://example.com") &&
    profileMd.includes("## Attributes") &&
    profileMd.includes("- AI") &&
    profileMd.includes("- (None)") && // Check empty array handling
    profileMd.includes("## Narrative")
) {
    console.log("✅ Full User Profile passed");
} else {
    console.error("❌ Full User Profile failed");
}
