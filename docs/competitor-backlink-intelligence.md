# Competitor Backlink Intelligence & Outreach Dossier

**Target Competitors Analyzed:** Tactiq (`tactiq.io`), AttendList (`attendlist.com`), Clay Codes (`claycodes.org`), MeetList (`meetlist.io`)  
**Data Sources:** Ahrefs Backlink Exports (`docs/ahrefs-exports/*-utf8.csv`)  
**Total Records Analyzed:** 3,423 records (Tactiq: 2,500; AttendList: 474; Clay Codes: 284; MeetList: 165)  
**Clean Non-Spam Prospects Identified:** 1,787 records (1,636 spam / scraper / link farm records filtered out)  
**Date of Investigation:** October 2026  

---

## Executive Summary & Strategic Findings

### 1. The Competitor Landscape
- **Clay Codes (`claycodes.org`)**: The historical pioneer of Google Meet attendance extensions (Clay Smith, 500k+ installs). **Critical Vulnerability**: The extension is functionally abandoned, trapped on deprecated Manifest V2 architecture, and suffers from a 2.8/5 star rating due to repeated Google Meet DOM breakage. Furthermore, **`https://claycodes.org/` (non-www) fails SSL protocol handshake entirely** due to a Google Sites certificate misconfiguration. 218 backlinks pointing to `https://claycodes.org/` lead to browser security failure pages.
- **AttendList (`attendlist.com`)**: Solo Ruby on Rails project by Harrison Broadbent (~6k installs). Its backlink profile is 92% spam/directory scrapers; nearly all legitimate high-DR backlinks stem from a viral Hacker News post about its *Ruby on Rails infrastructure stack* rather than organic EdTech or meeting productivity adoption.
- **MeetList (`meetlist.io`)**: Has ~400k installs but an extremely weak, low-DR backlink footprint (only 83 non-spam backlinks). It has achieved organic adoption without building authoritative institutional or educational backlinks.
- **Tactiq (`tactiq.io`)**: The 800-pound gorilla (DR 81, 2.5k backlinks in export), but has heavily pivoted from "Google Meet Attendance & Transcripts" to AI meeting notes/summaries and Zoom/Teams transcription. Several of its older high-value help center, blog, and FAQ target pages have returned HTTP 404, HTTP 403, or DNS NXDOMAIN.

### 2. High-Yield Attack Vectors for Attendance Tracker (`attendancetracker.dev`)
1. **Broken Link Reclamation (Claycodes SSL failure & dead pages)**: Reach out to top EdTech blogs (Eric Curts at Control Alt Achieve, Teq, Jake Miller) and institutional portals where instructors are directed to broken/insecure Claycodes pages.
2. **The "Manifest V2 / Google Meet API v2" Pitch**: Educate universities (.edu) and school districts that legacy DOM scraper extensions (Claycodes, MeetList) break on UI redesigns, violate student privacy, and face removal under Chrome's MV3 phase-out. Attendance Tracker is built natively on Google Meet's official REST API v2 inside Google Workspace Marketplace.
3. **Roundup Insertion**: Add Attendance Tracker to active 2026 Google Meet extension listicles (Vimeo DR 96, Formplus DR 70, Tinrec DR 9) that currently feature outdated tools.
4. **Directory & Hub Submissions**: Replicate competitor profiles on startup registries (Startup Fame DR 84, Twelve Tools DR 83, 500.tools DR 39).

---

## Part 1: Broken Link & Dead Target Intelligence

Our automated HTTP status verification discovered **22 dead, misconfigured, or inaccessible target URLs** across competitor backlink profiles.

| Target URL | HTTP / Error Status | Competitor | Total Referring Links | Key Referring Domains | Vulnerability / Strategic Replacement Angle |
|------------|---------------------|------------|-----------------------|-----------------------|----------------------------------------------|
| `https://claycodes.org/` | **SSL Handshake Failure** (`EOF protocol error`) | Clay Codes | 218 links | `blog.tcea.org`, `sdpc.a4l.org`, `jakemiller.net`, `engagetheirminds.com` | Google Sites custom SSL cert only valid for `www.claycodes.org`. Anyone clicking `https://claycodes.org/` receives a browser security error. |
| `https://www.claycodes.org/google-add-onsextensions/meet-attendance` | 200 (Site alive, but extension broken / 2.8 rating) | Clay Codes | 4 links | `controlaltachieve.com` (DR 53), `teq.com` (DR 52), `jose-david.com` (DR 14) | Clay Smith's extension is broken, abandoned, and unmaintained. Instructors complain of missed rolls and popups. |
| `https://blog.tactiq.io/how-to-save-google-meet-live-captions-so-you-can-read-it-later-325f57825425` | **HTTP 403 Forbidden** (Dead Medium Publication) | Tactiq | 1 link | `starterstory.com` (DR 76) | Tactiq abandoned its Medium blog post explaining how to capture Google Meet live captions/attendees. |
| `https://help.tactiq.io/pt-BR/articles/4786658-como-transcrever-uma-reuniao-online-no-google-meet` | **HTTP 404 Not Found** | Tactiq | 1 link | `esp.pb.gov.br` (DR 20, Brazilian State Health School) | Official scientific writing guide references a dead Tactiq help article. |
| `https://support.tactiq.io/` | **DNS NXDOMAIN** (getaddrinfo failed) | Tactiq | 1 link | `subscribed.fyi` (DR 37) | Dead sub-domain for support/help. |
| `https://tactiq.io/contact` | **HTTP 404 Not Found** | Tactiq | 1 link | `5app.ai` (DR 39) | Dead contact page on Tactiq. |
| `https://tactiq.io/faq` | **HTTP 404 Not Found** | Tactiq | 2 links | `whataicandotoday.com` (DR 29) | Dead FAQ endpoint. |
| `https://tactiq.io/copilot-pro-vs-microsoft-365-copilot` | **HTTP 404 Not Found** | Tactiq | 1 link | `findskill.ai` (DR 43) | Deleted comparison guide. |
| `https://tactiq.io/learn/4-ways-you-can-use-chatgpt-for-your-next-meeting` | **HTTP 404 Not Found** | Tactiq | 1 link | `sequence-events.com` (DR 29) | Deleted blog post on meeting AI. |
| `http://insights.meetlist.io:443/` & `http://meetlist.io:443/` | **HTTP 400 Bad Request** | MeetList | 6 links | `sitegraph.tech` (DR 9) | Malformed HTTP port request resulting in server 400. |

---

## Part 2: Category A — Academic & Institutional Prospects (.edu, .k12, .ac.*, .org, LibGuides)

These high-authority institutions link to competitor tools for classroom instruction, remote accessibility, or staff training.

### 1. Radford University — Center for Accessibility Services
- **Target Domain & DR**: `radford.edu` | **DR: 75**
- **Referring URL**: `https://www.radford.edu/accessibility-services/accessible-technology.html`
- **Page Title**: Assistive Technology | Radford University
- **Anchor Text**: `Tactiq` -> `https://tactiq.io/`
- **Context**: Radford's accessibility department curates approved accessible technology and remote meeting tools for faculty and students.
- **Replacement Angle / Pitch Strategy**: Position Attendance Tracker as a zero-barrier, accessible attendance tool. Unlike third-party bots or intrusive browser extensions, Attendance Tracker runs natively in Google Meet, requires zero screen-reader workarounds, and ensures student accommodation attendance is logged automatically.
- **Recommended Next Action**: Outreach to Radford Center for Accessibility Services (`cas@radford.edu`).

### 2. Portland Community College (PCC) — Accessible Ed & Disability Resources
- **Target Domain & DR**: `pcc.edu` | **DR: 75**
- **Referring URLs**:
  - `https://www.pcc.edu/disability/remote/notetaking/` (Notetaking approaches | Accessible Ed)
  - `https://www.pcc.edu/disability/remote/meetings/` (Online participation in meetings | Accessible Ed)
- **Anchor Text**: `tactiq.io` -> `https://tactiq.io/`
- **Context**: PCC provides remote teaching guidance for accessible meetings and attendance verification.
- **Replacement Angle / Pitch Strategy**: PCC instructors need accurate record-keeping for students with attendance accommodations and financial aid audit verification. Attendance Tracker provides timestamped join/leave logs without requiring students to type in chat.
- **Recommended Next Action**: Email Accessible Ed team at `disability.services@pcc.edu` or Faculty Technology Specialists.

### 3. University of Southern Queensland (UniSQ)
- **Target Domain & DR**: `unisq.edu.au` | **DR: 74**
- **Referring URL**: `https://www.unisq.edu.au/study/why-unisq/unisq-stories/blogs/top-ai-note-taking-tools`
- **Page Title**: Top AI note-taking tools for university students
- **Anchor Text**: `Tactiq` -> `https://tactiq.io/`
- **Context**: Student blog detailing essential tools for university lectures and seminar study groups.
- **Replacement Angle / Pitch Strategy**: Pitch a guest addition or companion article on "How to track group project attendance and seminar participation in Google Meet."
- **Recommended Next Action**: Contact UniSQ Communications & Blog Editor.

### 4. University of Hartford — Faculty Center for Learning Development (FCLD)
- **Target Domain & DR**: `hartford.edu` | **DR: 74**
- **Referring URL**: `https://www.hartford.edu/faculty-staff/faculty/fcld/teaching-resources/accessibility.aspx`
- **Page Title**: Digital Accessibility and Universal Design - Teaching Resources
- **Anchor Text**: `Tactiq Free YouTube Transcript Generator` -> `https://tactiq.io/tools/youtube-transcript`
- **Context**: Teaching resources hub maintained by FCLD for faculty using Google Workspace.
- **Replacement Angle / Pitch Strategy**: Introduce Attendance Tracker as an approved Google Workspace Marketplace solution for tracking faculty lecture attendance and hybrid class presence with zero student data exposure.
- **Recommended Next Action**: Email FCLD team (`fcld@hartford.edu`).

### 5. Student Data Privacy Consortium (SDPC / Access 4 Learning)
- **Target Domain & DR**: `sdpc.a4l.org` | **DR: 73**
- **Referring URL**: `https://sdpc.a4l.org/district_listing.php?districtID=6873`
- **Page Title**: District Agreements Listing
- **Anchor Text**: `Privacy Policy` -> `https://www.claycodes.org/home/privacy-policy`
- **Context**: School districts maintain privacy compliance databases through SDPC. Clay Smith previously listed Claycodes privacy policies.
- **Replacement Angle / Pitch Strategy**: Submit Attendance Tracker’s FERPA/COPPA-compliant privacy pledge to the SDPC registry. Because Attendance Tracker writes directly to user Drive and doesn't store student PII on vendor servers, it clears district IT security hurdles instantly.
- **Recommended Next Action**: Submit vendor privacy profile to the Student Data Privacy Consortium.

### 6. Texas Computer Education Association (TCEA TechNotes)
- **Target Domain & DR**: `blog.tcea.org` | **DR: 71**
- **Referring URLs**:
  - `https://blog.tcea.org/google-meet-add-ons-and-updates/` (Anchor: "Follow Clay’s tutorial to add this feature" -> `claycodes.org/google-meet-breakout-rooms`)
  - `https://blog.tcea.org/recording-video-into-google-slides/` (Anchor: "Clay Smith" -> `claycodes.org/google-add-onsextensions/record-to-slides`)
  - `https://blog.tcea.org/tag/g-suite-edu/` (Anchor: "Slides Timer")
- **Context**: Premier educational technology association in the US.
- **Replacement Angle / Pitch Strategy**: The Claycodes link on TCEA's Google Meet guide points to an outdated breakout room hack and Clay's broken tools. Pitch Director of Technology Miguel Guhlin on an updated guide: "The 2026 Guide to Google Meet Attendance: Moving from Broken Chrome Extensions to Native Workspace APIs".
- **Recommended Next Action**: Pitch Miguel Guhlin (`mguhlin@tcea.org`).

### 7. Carroll College
- **Target Domain & DR**: `carroll.edu` | **DR: 63**
- **Referring URL**: `https://www.carroll.edu/about-carroll/accessibility-policies-procedures/accessibility`
- **Page Title**: Accessibility | Carroll College
- **Anchor Text**: `Tactiq` -> `https://tactiq.io/`
- **Context**: Institutional accessibility and academic support resources.
- **Replacement Angle / Pitch Strategy**: Provide faculty and instructional designers with Attendance Tracker documentation for logging online session attendance.
- **Recommended Next Action**: Outreach to Carroll Academic Technology (`it-helpdesk@carroll.edu`).

### 8. Universidade Federal do Vale do São Francisco (UNIVASF)
- **Target Domain & DR**: `docs.univasf.edu.br` | **DR: 59**
- **Referring URL**: `https://docs.univasf.edu.br/ferramentas-transcricao`
- **Page Title**: Ferramentas de Transcrição e Gestão de Reuniões
- **Anchor Text**: `Tactiq` -> `https://tactiq.io/pt-br`
- **Context**: University documentation on meeting management and virtual classroom tools.
- **Replacement Angle / Pitch Strategy**: Suggest Attendance Tracker as the companion tool for class presence management in Google Meet.
- **Recommended Next Action**: Contact UNIVASF instructional tech department.

### 9. Pargas IT-Pedagogy (Finland)
- **Target Domain & DR**: `it-pedagog.edu.pargas.fi` | **DR: 54**
- **Referring URL**: `https://it-pedagog.edu.pargas.fi/startsida`
- **Page Title**: It-pedagog(i)
- **Anchor Text**: `it-pedagog(i) info` -> `https://www.claycodes.org/google-meet-breakout-rooms`
- **Context**: Municipal K-12 pedagogical guide for digital teaching.
- **Replacement Angle / Pitch Strategy**: Claycodes link is outdated; replace with modern Google Meet teaching tools.
- **Recommended Next Action**: Outreach to municipal IT-pedagog coordinators.

### 10. Escola de Saúde Pública da Paraíba (ESP-PB) — Government / Academic
- **Target Domain & DR**: `esp.pb.gov.br` | **DR: 20**
- **Referring URL**: `https://esp.pb.gov.br/nucleos/GuiadeEscritaCientficaDescomplicadaEstratgiadeReflexodaPrticaProfissionalnareadeSade.pdf`
- **Page Title**: Guia de Escrita Científica Descomplicada
- **Anchor Text**: `transcrever uma reunião` -> `https://help.tactiq.io/pt-BR/articles/4786658-como-transcrever-uma-reuniao-online-no-google-meet` (**DEAD LINK 404!**)
- **Context**: Official public health school guide for scientific writing and virtual meetings.
- **Replacement Angle / Pitch Strategy**: **Broken Link Pitch**. Inform the editorial coordinator that the Tactiq URL returns 404, and suggest replacing it with a current virtual meeting attendance and documentation resource.
- **Recommended Next Action**: Contact ESP-PB editorial coordinators (`esppb.nucleo@gmail.com`).

---

## Part 3: Category B — Best Google Meet Extensions Roundups & EdTech Listicles

These high-DR publications, influencers, and EdTech blogs actively rank extensions for Google Meet.

### 1. Vimeo Blog
- **Target Domain & DR**: `vimeo.com` | **DR: 96**
- **Referring URL**: `https://vimeo.com/blog/post/google-meet-extensions`
- **Page Title**: 7 Top Google Meet Extensions & Integrations
- **Anchor Text**: `Tactiq` -> `https://tactiq.io/`
- **Replacement Angle / Pitch Strategy**: Vimeo's guide highlights productivity extensions for Google Meet. Pitch Attendance Tracker as the definitive extension for corporate webinars, training calls, and community events where organizers need to verify attendance and attendee duration without interrupting the flow of the meeting.
- **Recommended Next Action**: Pitch Vimeo content marketing / blog team (`blog@vimeo.com`).

### 2. EdTech Magazine (Higher Ed)
- **Target Domain & DR**: `edtechmagazine.com` | **DR: 79**
- **Referring URL**: `https://edtechmagazine.com/higher/article/2020/06/5-videoconferencing-tools-student-group-projects-2020`
- **Page Title**: 5 Videoconferencing Tools for Student Group Projects
- **Anchor Text**: `breakout rooms` -> `https://www.claycodes.org/google-meet-breakout-rooms`
- **Replacement Angle / Pitch Strategy**: The article references Clay Smith's 2020 workaround for breakout rooms. Google Meet has since built breakout rooms natively, but attendance tracking across hybrid lecture halls remains unsolved natively for non-Enterprise tiers. Pitch a contributor article or update on modern classroom management tools.
- **Recommended Next Action**: Pitch EdTech Magazine Higher Ed editorial desk.

### 3. Windows Report
- **Target Domain & DR**: `windowsreport.com` | **DR: 76**
- **Referring URL**: `https://windowsreport.com/microsoft-teams-ai-note-taker/`
- **Page Title**: How to Use the Microsoft Teams AI Note Taker
- **Anchor Text**: `Tactiq Chrome extension` -> `https://tactiq.io/ai-tools/ai-note-taker-for-microsoft-teams`
- **Replacement Angle / Pitch Strategy**: Windows Report frequently reviews Google Meet and browser extensions. Pitch their software reviews team on reviewing Attendance Tracker.
- **Recommended Next Action**: Submit review pitch to Windows Report software desk.

### 4. Formplus Blog
- **Target Domain & DR**: `formpl.us` | **DR: 70**
- **Referring URL**: `https://www.formpl.us/blog/teacher-chrome-extensions`
- **Page Title**: Best Chrome Extensions for Teachers
- **Anchor Text**: `Taqtiq` -> `https://tactiq.io/`
- **Replacement Angle / Pitch Strategy**: Formplus curates administrative tools for educators. Pitch Attendance Tracker as the #1 tool for eliminating manual roll call and directly exporting attendance records to Google Sheets.
- **Recommended Next Action**: Outreach to Formplus content editor.

### 5. Dr. Catlin Tucker (Blended Learning Expert & Author)
- **Target Domain & DR**: `catlintucker.com` | **DR: 58**
- **Referring URL**: `https://catlintucker.com/2020/09/udl-blended-learning-representation/`
- **Page Title**: Universal Design for Learning and Blended Learning
- **Anchor Text**: `Tactiq is a Chrome extension` -> `https://tactiq.io/`
- **Replacement Angle / Pitch Strategy**: Dr. Tucker focuses on sustainable teacher workflows. Highlight how automated attendance tracking saves educators 5–10 minutes per class period, reducing administrative fatigue and supporting blended learning accountability.
- **Recommended Next Action**: Outreach via Catlin Tucker's contact form.

### 6. Alice Keeler (Teacher Tech)
- **Target Domain & DR**: `alicekeeler.com` | **DR: 56**
- **Referring URLs**:
  - `https://alicekeeler.com/2023/08/07/auto-advance-google-slides-slides-timer-by-claycodes/`
  - `https://alicekeeler.com/2024/09/07/slides-timer-add-on/`
  - `https://alicekeeler.com/2022/07/24/bulk-suspend-google-accounts/`
- **Anchor Text**: `ClayCodes Slides Timer Chrome Extension`, `This free Add-on by {CLAYCODES}`
- **Context**: Alice Keeler is one of the world's most prominent Google Certified Innovators. She frequently promotes Claycodes tools.
- **Replacement Angle / Pitch Strategy**: Pitch Alice on how Attendance Tracker modernizes Google Meet by leveraging the native Google Meet REST API v2 and Google Workspace Marketplace add-on architecture, avoiding the fragile DOM scraping that broke Clay Smith's tools.
- **Recommended Next Action**: Direct pitch to Alice Keeler (`alice@alicekeeler.com`).

### 7. Shake Up Learning (Kasey Bell)
- **Target Domain & DR**: `shakeuplearning.com` | **DR: 56**
- **Referring URL**: `https://shakeuplearning.com/blog/on-air-coaching-engaging-students-who-arent-interested-in-the-content-suls054/`
- **Page Title**: [On-Air Coaching] Engaging Students Who Aren't Interested in the Content
- **Anchor Text**: `Chrome extension that allows you to put a live timer` -> `https://www.claycodes.org/google-add-onsextensions/slides-timer`
- **Replacement Angle / Pitch Strategy**: Kasey Bell has over 100k educator subscribers. Pitch a sponsored or featured review of Attendance Tracker as the recommended solution for Google Classroom and Google Meet attendance.
- **Recommended Next Action**: Outreach to Kasey Bell (`hello@shakeuplearning.com`).

### 8. Control Alt Achieve (Eric Curts) — *TOP PRIORITY BROKEN LINK TARGET*
- **Target Domain & DR**: `controlaltachieve.com` | **DR: 53**
- **Referring URL**: `https://www.controlaltachieve.com/2020/03/google-news-march2020.html`
- **Page Title**: Control Alt Achieve: What's New in Google - March 2020
- **Anchor Text**: `Resource Link` -> `https://www.claycodes.org/google-add-onsextensions/meet-attendance`
- **Context**: Eric Curts is a Google Certified Trainer whose blog is referenced by hundreds of thousands of educators. His post directly links to Claycodes' "Meet Attendance" tool.
- **Replacement Angle / Pitch Strategy**: Direct broken/deprecated tool replacement pitch. Clay's extension has 2.8 stars and broken DOM scrapers. Eric actively maintains his guides and champions modern Google Workspace Marketplace solutions.
- **Recommended Next Action**: Email Eric Curts (`ericcurts@gmail.com`).

### 9. Teq (OTIS for Educators) — *TOP PRIORITY BROKEN LINK TARGET*
- **Target Domain & DR**: `teq.com` | **DR: 52**
- **Referring URL**: `https://www.teq.com/chrome-extensions-to-benefit-your-google-meet/`
- **Page Title**: Chrome Extensions to Benefit Your Google Meet
- **Anchor Text**: `attendance extension` -> `https://www.claycodes.org/google-add-onsextensions/meet-attendance` & `Claycodes.org` -> `http://claycodes.org/`
- **Context**: Teq's guide specifically recommends Claycodes for taking attendance in Meet!
- **Replacement Angle / Pitch Strategy**: Inform the author (Matthew Thaxter) that the Claycodes links lead to an unmaintained extension and SSL errors. Offer Attendance Tracker as the tested, modern replacement that complies with district security policies.
- **Recommended Next Action**: Email author Matthew Thaxter (`MatthewThaxter@teq.com`) and editorial desk.

### 10. Jake Miller (Educational Duct Tape)
- **Target Domain & DR**: `jakemiller.net` | **DR: 45**
- **Referring URL**: `https://jakemiller.net/tag/gsuite/`
- **Page Title**: GSuite – Jake Miller
- **Anchor Text**: `gSuite Add-Ons and Chrome Extensions` -> `https://www.claycodes.org/google-add-onsextensions` & `Clay Smith` -> `https://www.claycodes.org/home/bio`
- **Context**: Jake Miller’s podcast and blog focus on finding the right EdTech tool for specific classroom problems.
- **Replacement Angle / Pitch Strategy**: Pitch an episode or blog feature on "Solving the Google Meet Attendance Problem Without Duct Tape".
- **Recommended Next Action**: Pitch Jake Miller (`jake@jakemiller.net`).

### 11. The Marketing Agency
- **Target Domain & DR**: `themarketingagency.ca` | **DR: 33**
- **Referring URL**: `https://themarketingagency.ca/blog/google-meet-breakout-rooms/`
- **Page Title**: Google Meet Breakout Rooms Guide
- **Anchor Text**: `Attendance tracking data from Google Meet sessions` -> `https://tactiq.io/learn/google-meet-attendance-report`
- **Replacement Angle / Pitch Strategy**: The post specifically mentions exporting attendance tracking data. Tactiq no longer emphasizes raw attendance reports. Pitch Attendance Tracker’s automated Google Sheets export and duration tracking as a direct citation.
- **Recommended Next Action**: Contact editorial team at `themarketingagency.ca`.

### 12. Jose David (EdTech in Spanish)
- **Target Domain & DR**: `jose-david.com` | **DR: 14**
- **Referring URL**: `https://jose-david.com/blog/g-for-education/como-pasar-lista-en-hangouts-meet/`
- **Page Title**: Cómo pasar lista automáticamente en Hangouts Meet
- **Anchor Text**: `«Meet Attendance» o «Asistencia en Meet»` -> `https://www.claycodes.org/google-add-onsextensions/meet-attendance`
- **Context**: Detailed tutorial teaching teachers in Spain and Latin America how to take attendance.
- **Replacement Angle / Pitch Strategy**: The tutorial recommends Clay Smith's dead extension. Pitch Attendance Tracker with its full Spanish localization and native Google Workspace integration.
- **Recommended Next Action**: Contact Jose David via his blog contact form.

### 13. Tinrec Blog (Asia / Taiwan AI & Meeting Publication)
- **Target Domain & DR**: `tinrec.com` | **DR: 9**
- **Referring URLs**:
  - `https://tinrec.com/blog/16494` ("Google Meet 出席名單能給你什麼、給不了什麼？")
  - `https://tinrec.com/blog/16385` ("8 Best Google Meet Attendance Trackers for 2026")
- **Anchor Text**: `MeetList.io`, `Google Meet Attendance Tracker | AttendList`, `Tactiq.io`
- **Context**: Highly relevant 2026 comparison reviews analyzing MeetList, AttendList, and Tactiq side by side.
- **Replacement Angle / Pitch Strategy**: Tinrec is actively looking for the best attendance tools. Attendance Tracker must be submitted to be included in their 2026 comparison table.
- **Recommended Next Action**: Contact Tinrec editorial team via `tinrec.com/contact`.

### 14. Sunoger.pl (Polish IT & Google Workspace Blog)
- **Target Domain & DR**: `www.sunoger.pl` | **DR: 0.8**
- **Referring URL**: `https://www.sunoger.pl/tworzenie-listy-obecnosci/`
- **Page Title**: Tworzenie listy obecności ze spotkań Google Meet do Google Sheets
- **Anchor Text**: `AttendList: Google Meet Attendance Tracker & Reports` -> `https://attendlist.com/`
- **Context**: Step-by-step Polish tutorial on creating attendance sheets from Google Meet.
- **Replacement Angle / Pitch Strategy**: Pitch Attendance Tracker as the official Google Workspace Marketplace add-on that automates Google Sheets sync without local browser extensions.
- **Recommended Next Action**: Outreach to Sunoger.pl author.

---

## Part 4: Category C — High-DR Software Directories & Resource Hubs

Competitors have acquired strong backlink equity and referral traffic from software discovery platforms.

| Domain | DR | Competitor Listed | Existing Target URL | Recommended Action for Attendance Tracker | Priority |
|--------|----|-------------------|---------------------|-------------------------------------------|----------|
| `workspace.google.com` | **100** | Claycodes | `https://www.claycodes.org/home/privacy-policy` | Optimize Attendance Tracker Google Workspace Marketplace listing with localized keywords, video demo, and screenshots. | P0 |
| `startupfa.me` | **84** | AttendList | `https://attendlist.com/` | Create & claim Attendance Tracker product listing on Startup Fame. | P1 |
| `contra.com` | **84** | Tactiq | `https://tactiq.io/` | Create a verified developer showcase and tool listing on Contra. | P2 |
| `twelve.tools` | **83** | AttendList | `https://attendlist.com/` | Submit Attendance Tracker to Twelve Tools (curated indie developer directory). | P1 |
| `starterstory.com` | **76** | Tactiq | `https://blog.tactiq.io/...` (**DEAD 403**) | Submit founder interview / case study to StarterStory on scaling a Google Workspace add-on, flagging the broken Tactiq link. | P1 |
| `sideprojectors.com` | **71** | AttendList | `https://attendlist.com/` | List Attendance Tracker on SideProjectors showcase. | P2 |
| `topai.tools` | **64** | Tactiq | `https://tactiq.io/?via=topaitools` | Submit Attendance Tracker under "Chrome Extensions" & "Productivity". | P2 |
| `toolfinder.com` | **62** | Tactiq | `https://tactiq.io/` | Submit Attendance Tracker to "Best AI Meeting Tools" list. | P1 |
| `500.tools` | **39** | AttendList | `https://attendlist.com/` | Submit Attendance Tracker under "Meeting Software Tools" category. | P1 |
| `5app.ai` | **39** | Tactiq | `https://tactiq.io/contact` (**DEAD 404**) | Submit Attendance Tracker to AI Meeting Assistant list; notify editor of dead Tactiq contact link. | P2 |
| `subscribed.fyi` | **37** | Tactiq | `https://support.tactiq.io/` (**DEAD NXDOMAIN**) | Claim SaaS profile; report dead Tactiq support domain. | P2 |
| `weuserails.com` | **29** | AttendList | `https://attendlist.com/?ref=weuserails.com` | N/A (Rails specific). | - |
| `whataicandotoday.com` | **29** | Tactiq | `https://tactiq.io/faq` (**DEAD 404**) | Submit Attendance Tracker; notify editor of dead FAQ URL. | P2 |
| `indiehackerstacks.com` | **26** | AttendList | `https://attendlist.com/?ref=indiehackerstacks` | Submit Attendance Tracker tech stack (Google Cloud, Meet API v2, Workspace SDK). | P2 |
| `hazumi.news` | **21** | AttendList | `https://attendlist.com/` | Submit product release announcements to tech news aggregator. | P3 |
| `ilovechrome.com` | **14** | Claycodes / MeetList | `https://meetlist.io/` | Monitor automated scraper mirror; ensure metadata and homepage URL are correct. | P3 |
| `extension.vn` | **12** | AttendList / MeetList / Clay | `https://meetlist.io/privacy-policy/` | Claim extension community profile and manage reviews. | P3 |
| `extwise.com` | **2.8** | MeetList | `https://meetlist.io/` | Claim extension security profile. | P3 |

---

## Part 5: Category D — Tech & Productivity Blogs (Meeting Attendance & Productivity Focus)

High-DR blogs and technology review sites that covered competitors specifically for meeting management and note-taking.

### 1. Atlassian Blog
- **Domain & DR**: `atlassian.com` | **DR: 92**
- **Referring URL**: `https://www.atlassian.com/blog/ai-at-work/ai-meeting-notes-tools`
- **Page Title**: AI Meeting Notes: Streamline Collaboration and Documentation
- **Target**: Tactiq (`https://tactiq.io/`)
- **Pitch Angle**: Remote meeting compliance: how high-performance engineering and product teams ensure standup attendance and sprint review participation without tedious roll calls.
- **Recommended Action**: Pitch contributor article or comment to Atlassian work-life editorial team.

### 2. Salesforce ANZ
- **Domain & DR**: `salesforce.com` | **DR: 92**
- **Referring URL**: `https://www.salesforce.com/au/blog/10-steps-to-a-successful-sales-meeting-with-an-agenda-template/`
- **Page Title**: Meeting Agenda Templates: 10 Tips for Better Sales Meetings
- **Target**: Tactiq (`https://tactiq.io/learn/sales-meeting-agenda-templates`)
- **Pitch Angle**: Attendee engagement tracking in prospect discovery and client demonstration meetings.
- **Recommended Action**: Outreach to Salesforce ANZ blog team.

### 3. Affine Pro
- **Domain & DR**: `affine.pro` | **DR: 72**
- **Referring URLs**:
  - `https://affine.pro/blog/best-ai-note-taking-chrome-extension-tips`
  - `https://affine.pro/blog/ai-meeting-assistant-for-google-meet-tips`
- **Page Title**: AI Note-Taking Chrome Extensions: Web, YouTube & Meetings | Top AI Meeting Assistants for Google Meet
- **Target**: Tactiq (`https://tactiq.io/`, `https://tactiq.io/buy`, `https://help.tactiq.io/...`)
- **Pitch Angle**: Affine produces in-depth Google Meet tool comparisons. Pitch Attendance Tracker as the recommended attendance companion to AFFiNE note-taking.
- **Recommended Action**: Contact Affine content team (`contact@toeverything.info`).

### 4. Morgen Calendar Blog
- **Domain & DR**: `morgen.so` | **DR: 73**
- **Referring URL**: `https://www.morgen.so/blog-posts/how-to-transcribe-google-meet`
- **Page Title**: How to Transcribe Google Meet: 7 Best Chrome Extensions
- **Target**: Tactiq (`https://tactiq.io/`)
- **Pitch Angle**: Calendar management meets attendance accountability: how busy professionals and team leads verify calendar invite attendance automatically.
- **Recommended Action**: Outreach to Morgen marketing team.

### 5. Kumospace Blog
- **Domain & DR**: `kumospace.com` | **DR: 64**
- **Referring URL**: `https://www.kumospace.com/blog/google-meet-time-limits`
- **Page Title**: Stop Worrying About Google Meet Time Limits with These Hacks
- **Target**: Tactiq (`https://tactiq.io/`)
- **Pitch Angle**: Managing attendee duration logs and attendance verification under Google Meet session constraints.
- **Recommended Action**: Pitch Kumospace editorial team.

### 6. GetOdin AI Blog
- **Domain & DR**: `blog.getodin.ai` | **DR: 49**
- **Referring URL**: `https://blog.getodin.ai/google-meet-notetaker/`
- **Page Title**: 5 Google Meet Notetaker Tools for Higher Team Productivity
- **Target**: Tactiq (`http://tactiq.io/`)
- **Pitch Angle**: Pitch Attendance Tracker for roundups highlighting meeting productivity tools.
- **Recommended Action**: Outreach to Odin AI blog team.

### 7. Whisper Memos
- **Domain & DR**: `whispermemos.com` | **DR: 47**
- **Referring URL**: `https://whispermemos.com/articles/google-meet-transcription`
- **Page Title**: How to Transcribe Google Meet Calls in 2026
- **Target**: Tactiq (`https://tactiq.io/buy`)
- **Pitch Angle**: Tool ecosystem integration: pairing transcription with automated attendance tracking.
- **Recommended Action**: Submit tool review pitch.

---

## Part 6: Outreach Pitch Templates & Action Matrix

### Template 1: The Broken Tool / Deprecated Extension Replacement Pitch
*(Targeted at Eric Curts / Control Alt Achieve, Teq, Jake Miller, TCEA)*

**Subject:** Outdated/broken Google Meet attendance tool on [Website / Article Title]

Hi [Name / Team],

I was reading your guide on [Article Title / Topic] ([URL]) and noticed you recommended the "Meet Attendance" tool by Clay Codes (`claycodes.org`).

Just wanted to pass along a quick heads-up: Clay Smith's extension has been largely unmaintained since Google revamped Meet's user interface. Because it relied on DOM web scraping, it repeatedly breaks when Google updates meeting classes, leaving instructors with empty spreadsheets and a 2.8-star user rating on the Chrome Web Store. Furthermore, links to `https://claycodes.org` are currently throwing SSL protocol errors for visitors.

Our team developed **Attendance Tracker** (https://attendancetracker.dev), an official Google Workspace Marketplace add-on built directly on Google Meet's native REST API v2. Because it operates inside the native Meet Activities panel:
1. **Immune to DOM redesigns:** Reads attendee connection tokens directly via Google Meet's API v2 rather than parsing HTML elements.
2. **Zero installation on managed Chromebooks:** Launches natively in the Meet side panel without requiring teachers or students to install local Chrome extensions.
3. **FERPA & Privacy compliant:** All attendee logs and duration metrics save directly to the educator's own Google Drive / Google Sheets.
4. **LMS export:** Instant CSV / Sheets export formatted for Google Classroom, Canvas, and Moodle gradebooks.

If you are updating your post for this academic term, updating the link to Attendance Tracker (or our comprehensive 2026 extension breakdown at https://attendancetracker.dev/best-google-meet-attendance-extensions.html) would save your readers significant troubleshooting time.

Best regards,  
Derek Gallardo  
Founder, Attendance Tracker  
https://attendancetracker.dev  

---

### Template 2: The Roundup Insertion Pitch
*(Targeted at Vimeo, Formplus, Affine, Tinrec, ToolFinder)*

**Subject:** Suggested addition for your [Article Title]: Native Google Meet Attendance Tracker

Hi [Name / Editorial Team],

I really enjoyed your recent breakdown of Google Meet tools in "[Article Title]" ([URL]) — especially your focus on actionable extensions like [Competitor Name].

One critical workflow missing from most roundups is **automated attendance and duration tracking**. For educators, remote sprint leaders, and webinar hosts, manual roll call consumes 5–10 minutes per session.

Would you be open to including **Attendance Tracker** (https://attendancetracker.dev)? 

Unlike legacy tools that scrape browser HTML, Attendance Tracker is an official Google Workspace Marketplace add-on built on Google's new Meet REST API v2:
- **Automatic Attendee & Duration Logging:** Accurately captures arrival, leave, and total time in meeting.
- **Native Side-Panel Execution:** Operates directly inside the Google Meet interface (zero client-side extension required on locked-down school/enterprise devices).
- **1-Click Google Sheets Sync:** Generates clean, formatted spreadsheets directly in user Google Drive.

Happy to provide a complimentary Pro license or screenshots/copy tailored to your article's format.

Best,  
Derek Gallardo  
Attendance Tracker  
https://attendancetracker.dev  

---

### Template 3: The Broken Help / FAQ Link Pitch
*(Targeted at StarterStory, 5app.ai, Subscribed.FYI, WhatAICanDoToday, ESP-PB)*

**Subject:** Broken link on [Page Title]

Hi [Name / Webmaster],

I was browsing your page at [URL] and noticed that the link pointing to [Competitor Name] ([Broken Competitor URL]) is currently returning a [404 Not Found / 403 / DNS error].

If you are looking for an active, maintained solution to replace it, [Attendance Tracker](https://attendancetracker.dev) provides [brief relevant description, e.g., verified attendance and meeting logging for Google Meet].

Hope this helps keep your resource directory clean and up to date!

Best,  
Derek Gallardo  
https://attendancetracker.dev  

---

## Action Plan & Prioritized Execution Checklist

1. **Sprint 1 (Week 1 — High-Priority EdTech Broken Links)**:
   - [ ] Dispatch Template 1 to Eric Curts (`controlaltachieve.com` - DR 53).
   - [ ] Dispatch Template 1 to Matthew Thaxter at Teq (`teq.com` - DR 52).
   - [ ] Dispatch Template 1 to Miguel Guhlin at TCEA (`blog.tcea.org` - DR 71).
   - [ ] Dispatch Spanish Template to Jose David (`jose-david.com` - DR 14).
2. **Sprint 2 (Week 2 — Institutional & Academic Outreach)**:
   - [ ] Submit vendor privacy profile to SDPC (`sdpc.a4l.org` - DR 73).
   - [ ] Outreach to Radford University Accessibility Services (`radford.edu` - DR 75).
   - [ ] Outreach to Portland Community College Accessible Ed (`pcc.edu` - DR 75).
   - [ ] Outreach to University of Hartford FCLD (`hartford.edu` - DR 74).
   - [ ] Fix broken link outreach with ESP-PB (`esp.pb.gov.br` - DR 20).
3. **Sprint 3 (Week 3 — Directory Submissions & Broken Resource Reclamation)**:
   - [ ] Submit to Startup Fame (`startupfa.me` - DR 84).
   - [ ] Submit to Twelve Tools (`twelve.tools` - DR 83).
   - [ ] Submit to 500.tools (`500.tools` - DR 39).
   - [ ] Pitch StarterStory (`starterstory.com` - DR 76) & flag broken Tactiq Medium link.
   - [ ] Submit to ToolFinder (`toolfinder.com` - DR 62) and TopAI.tools (`topai.tools` - DR 64).
4. **Sprint 4 (Week 4 — High-DR Roundups & Productivity Blogs)**:
   - [ ] Pitch Vimeo Blog editorial team (`vimeo.com` - DR 96).
   - [ ] Pitch Formplus content team (`formpl.us` - DR 70).
   - [ ] Pitch Affine Pro comparison team (`affine.pro` - DR 72).
   - [ ] Pitch Tinrec blog (`tinrec.com` - DR 9) for their 2026 attendance tools guide.
   - [ ] Pitch Alice Keeler (`alicekeeler.com` - DR 56) and Kasey Bell (`shakeuplearning.com` - DR 56).
