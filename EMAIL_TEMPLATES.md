# **📨 Index Network — Email Communication Rules**

Index uses three types of emails:

* **Connection Request Emails**  
  * → Real-time, triggered when someone wants to connect with you.  
* **Mutual Opt-In Emails (Double Opt-In Intros)**  
  * → Sent when both people approve a connection.  
* **Weekly Inbox Discovery Emails**  
  * → Sent conditionally, only when new high-relevancy people appear.

## **Real-Time Emails**

1. ### **Connection Request Email**

Sent when Alice wants to connect with Bob.

**Subject rules:** 

* include the person’s name,  
* highlight our strongest mutual‑intent synergy,  
* stay under 12 words,  
* sound warm, professional, and action‑oriented.

**Vibecheck text rules:** 

Shorten original vibecheck text into a clean, email-ready paragraph. Keep the meaning, keep it warm, cut \~35% of the words

**Email Template:**

| Example Subjects (subject will be generated from shared intents)  | Cooper \- exploring shared work on scalable coordination Shresth \- mutual interest in decentralized networking \+ privacy-preserving AI Verber \- shared intent around collaborative AI systems Joshua \- aligning on ecosystem seeding \+ open coordination Rani \- shared vision for open discovery systems Chris \- mutual focus on intent-driven discovery Andy \- exploring alignment on open web3 futures Danny \- potential fit around geo-data communities \+ discovery Vish \- shared intent around democratized systems Brennan \- connecting on AI-assisted governance \+ coordination Rakshita \- mutual interest in discovery across social platforms |
| :---- | :---- |
| **Body** | Hey Bob, You’ve got a new connection request on Index, **Alice** wants to connect with you. 👉 **Go to Index to approve** What could happen between you two:*You’re refining how agents negotiate access in private spaces, and Alice has been working through similar coordination problems from a systems angle. Your current focus meets her recent exploration \- it’s the kind of overlap where one conversation can save weeks of circling alone.* If you want to move it forward, I’ll make the introduction. If not, everything stays quiet. —Index |

**Rules:**

* Only send when a real connection request is made.  
* No follow-ups if the user ignores it.  
* No information is shared with the requester unless the recipient approves.

2. ### **Double opt-in Email**

**Sent when both people say yes.**

**Email Template:**

| Field | Content |
| :---- | :---- |
| **Subject** | Alice \<\> Bob \- something’s here |
| **Body** | Hey Alice and Bob, You both said yes, love when that happens. From what you’re each exploring, this felt like a connection worth bringing into the real world. Whether it turns into a conversation, a collaboration, or just a useful exchange, it’s yours now. Quick recap:– **Alice** is exploring ways teams can coordinate without exposing everything upfront  – **Bob** is focused on early-stage private alignment across distributed systems  – **You both** care about building connections that don’t rely on visibility or performance No formal intros needed \- just reply here and pick it up from wherever feels right. —Your discovery agent, quietly cheering from the background |

## **Weekly Inbox Discovery Emails**

### **Frequency Logic**

Weekly email sends **only if**:

* There are **1 or more new high-relevance matches**, **AND**  
* The matches are meaningfully aligned with the user’s current direction.

### **Weekly Inbox Email Template**

| Field | Content |
| :---- | :---- |
| **Subject** | You’ve got 10 conversations waiting in your Index Inbox |
| **Body** | Hey Seren, Index’s agents surfaced a few people this week whose work lines up unusually well with the things you’re pushing right now \- fundraising, agent deployments, protocol scaling, semantic web thinking, and the early shape of a discovery network. Each one can shift something forward \- choose your move, and I’ll take the next step with you. ![👉][image1] [**Go to your Inbox**](http://index.network/) **Alice \- *early-stage crypto investor \+ protocol tooling*** You’re raising a pre-seed round to fund development and onboarding, and Alice has been backing infra teams working on open coordination layers. She’s been exploring “semantic interfaces” for networks \- very close to what you’re looking for in investor conversations. **Bob \- *builds internal AI copilots for enterprise orgs*** You’re validating match quality and privacy inside real communication channels. Bob has deployed AI agents across Slack and Teams and already solved many of the rollout and UX challenges you’re about to face. **Carla \- *researcher building agent interoperability tooling*** You’re working toward powering matching across ChatGPT, Claude, and Google Agent Space. Carla has been experimenting with multi-model agent protocols \- almost exactly the direction you’re pushing. **Daniel \- *tokenomics engineer for staking & curation markets*** You’re designing a market where agents stake to propose high-relevancy matches. Daniel has built similar staking schemas and run simulations around adversarial behavior \- shortcuts you probably want. **Elena \- *founder coordinating 3K+ user communities*** You’re seeding a 500-person, high-signal graph. Elena runs communities where these users already gather. Her ecosystems could accelerate your network effects. ![👉][image2] [**Go to your Inbox**](http://index.network/) —Index, keeping your next moves within reach   |

## **Frequency & Behavioral Rules Summary**

| Email Type | Sending Rule | Notes |
| :---- | :---- | :---- |
| **Real-Time (Connection Request)** | Send immediately. Never batch. | Only send to the receiving side. |
| **Double Opt-In (Intro Email)** | Send only when both accept. | One email sent to both people. Always warm, minimal, “take it from here”. |
| **Weekly Inbox Email** | Send only if 1+ new aligned people surfaced | If nothing meaningful happened → no email. |

[image1]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABEAAAARCAMAAAAMs7fIAAADAFBMVEUAAAD6pwD6pwD6pwC1Xhm1Xhm1Xhm1Xhn6pwC1Xhn6pwC1Xhn6pwD6pwC1Xhn6pwD6pwC1Xhm1Xhn6pwD6pwD6pwC1Xhn6pwC1Xhn6pwD6pwC1Xhn7sAr/yij/yij/yijeigr0oAK1Xhm1Xhm1Xhn/yijahQzusSX6pwDGcBP7rgj/yCb/yijwrRu1Xhn+xiPDchz7qwXalCH8tA/tryT9vRn6wyfxtiXfmyH9vxzIeR38thL2vSb9uRTRhx/6qQPjoiL+wyH5vSD+wR79uxf7sArchwvvphS5YxfMgB66ZRrxtCPgjgz2ogLplQbCbBTtnAfYgw2+Zxb2pwftmQXgjAn8sg2+bBvoqCPTfg7mnRfPeRAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABOrwXtAAAAKHRSTlMAQL/fgJ9AvyAgUGCPcHAw7zDfnxCAUM+vr2DvQEBwgJ+vz48QMM/PnE38UwAAAHBJREFUeF5jYMAFNOAsJgjFwaKHJqIA48NENFgYHsBEGEGEFhODwBsgfYuBQfAtUESKjwUmDwQPgboQAgJsfEyfGRl0YPw/n56BKKhdIMAIFkAW+Q+hECIa6jARDjYoayOEBrtHj4GHQWD3b4gIeQAA50YO0R/2ks4AAAAASUVORK5CYII=>

[image2]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABEAAAARCAMAAAAMs7fIAAADAFBMVEUAAAD6pwD6pwD6pwC1Xhm1Xhm1Xhm1Xhn6pwC1Xhn6pwC1Xhn6pwD6pwC1Xhn6pwD6pwC1Xhm1Xhn6pwD6pwD6pwC1Xhn6pwC1Xhn6pwD6pwC1Xhn7sAr/yij/yij/yijeigr0oAK1Xhm1Xhm1Xhn/yijahQzusSX6pwDGcBP7rgj/yCb/yijwrRu1Xhn+xiPDchz7qwXalCH8tA/tryT9vRn6wyfxtiXfmyH9vxzIeR38thL2vSb9uRTRhx/6qQPjoiL+wyH5vSD+wR79uxf7sArchwvvphS5YxfMgB66ZRrxtCPgjgz2ogLplQbCbBTtnAfYgw2+Zxb2pwftmQXgjAn8sg2+bBvoqCPTfg7mnRfPeRAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABOrwXtAAAAKHRSTlMAQL/fgJ9AvyAgUGCPcHAw7zDfnxCAUM+vr2DvQEBwgJ+vz48QMM/PnE38UwAAAHBJREFUeF5jYMAFNOAsJgjFwaKHJqIA48NENFgYHsBEGEGEFhODwBsgfYuBQfAtUESKjwUmDwQPgboQAgJsfEyfGRl0YPw/n56BKKhdIMAIFkAW+Q+hECIa6jARDjYoayOEBrtHj4GHQWD3b4gIeQAA50YO0R/2ks4AAAAASUVORK5CYII=>