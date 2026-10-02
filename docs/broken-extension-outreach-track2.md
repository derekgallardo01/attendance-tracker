# Track 2: .edu & K-12 Broken / Deprecated Extension Outreach & EdTech Registries

## Overview
This document operationalizes **Track 2**: reaching out to higher-ed institutions, university colleges of education, educational technology associations, and school districts that still host guides, tutorials, or IT articles recommending unmaintained/broken Google Meet attendance extensions (e.g., **"Meet Attendance" by Clay Codes / claycodes.org**, abandoned since February 2023; **"Attendance for Google Meet" by Tyler and Adit**, abandoned since April 2023; or delisted scrapers like **Attendance Collector**).

Additionally, it contains the copy-paste-ready submission packages for **MERLOT** (DA 76) and the **ISTE EdTech Index** (formerly the EdSurge Product Index, DA 84).

---

## Part 1: Verified Prospect Outreach List

| # | Institution / Organization | Domain Authority | Target URL | Deprecated Tool Mentioned | Target Department / Contact Person | Email Address |
|---|-----------------------------|------------------|------------|---------------------------|-------------------------------------|---------------|
| 1 | **University of Rhode Island (URI)** — Feinstein College of Education | DA 79 | `https://web.uri.edu/education/online-tools/` | "Meet Attendance" Chrome extension (alongside broken Grid View) | Feinstein College IT / Dean's Office / URI Online | `helpdesk@uri.edu`, `online@uri.edu`, `danielle_dennis@uri.edu`, `amy.broemmel@uri.edu` |
| 2 | **Universidad de Puerto Rico - Recinto de Río Piedras (UPRRP)** — DECEP | DA 74 | `https://decep.uprrp.edu` (Video & guide: "Instalando y explorando la extensión de Meet Attendance") | "Meet Attendance" Chrome extension | Prof. Arian Mercado Mojica (Instructor/Narrator) & UEL DECEP | `decep.rp@upr.edu`, `recaudaciones.deceprp@upr.edu` |
| 3 | **Texas Computer Education Association (TCEA)** | DA 72 | `https://blog.tcea.org/tracking-attendance-for-virtual-learners/` | "Meet Attendance" Chrome extension | Miguel Guhlin (Director of Technology & Author) / Editorial Team | `mguhlin@tcea.org`, `info@tcea.org` |
| 4 | **Teq / OTIS for Educators** (Leading K-12 EdTech PD Partner) | DA 55+ | `https://www.teq.com/blog/2020/05/chrome-extensions-to-benefit-your-google-meet/` | "Meet Attendance" by Claycodes.org | Matthew Thaxter (Director of eLearning & Author) | `MatthewThaxter@teq.com`, `info@teq.com` |
| 5 | **Tech & Learning (Future B2B)** | **DA 82** | `https://www.techlearning.com/how-to/6-tips-for-teaching-with-google-meet` (Article by Brian Nadel) | "Meet Attendance" Chrome extension by Claycodes.org | Christine Weiser (Content Director) / Brian Nadel (Author) | `christine.weiser@futurenet.com`, `techlearning@futurenet.com` |
| 6 | **The Connecting Link (TCL)** (Accredited Teacher Continuing Education) | DA 45+ | `https://www.connectinglink.com` (Article: "Facilitation of Successful Online Learning Experiences") | "Chrome Meet Attendance extension by Claycodes.org" | Michael McGowan (Course Author & Instructional Designer) | `info@connectinglink.com` |
| 7 | **Austin Community College (ACC)** — Academic Technology NEXUS | DA 68 | `https://instruction.austincc.edu/nexus/` | Legacy Google Meet Chrome extensions & DOM scrapers | Faculty & Staff Academic Technology Support / Matthew Evins (Director) | `acctech@austincc.edu` |
| 8 | **Cult of Pedagogy** (Teacher's Guide to Tech) | **DA 74** | `https://www.cultofpedagogy.com` (Directory & Teacher's Guide to Tech) | Deprecated Meet attendance scrapers | Jennifer Gonzalez (Editor-in-Chief & Founder) | `editor@cultofpedagogy.com` |

---

## Part 2: Ready-to-Dispatch Tailored Outreach Pitches

### Pitch 1: University of Rhode Island (Feinstein College of Education)
**To:** `online@uri.edu`, `helpdesk@uri.edu`  
**CC:** `danielle_dennis@uri.edu`, `amy.broemmel@uri.edu`  
**Subject:** Outdated Google Meet attendance tool on Feinstein College resource page  

Hi URI Academic Technology & Feinstein College Support Team,

I was reviewing your faculty guide on remote teaching and virtual classroom resources (https://web.uri.edu/education/online-tools/) and noticed it currently recommends the "Meet Attendance" Chrome extension.

Just wanted to pass along a quick note: that extension has been unmaintained since early 2023, and instructors frequently run into broken roll capture due to Google Meet interface redesigns (in addition to unexpected subscription popups from its developer).

Our team built Attendance Tracker (https://attendancetracker.dev), an official Google Workspace Marketplace add-on built directly on Google Meet's native REST API v2. Because it runs natively inside Meet's side panel rather than scraping the browser DOM:
- **Never breaks on layout updates:** Reads API attendee tokens rather than DOM elements.
- **Zero client-side friction:** Runs natively in the Meet Activities panel on managed school Chromebooks, Mac, and Windows without requiring any local browser extensions.
- **LMS & Classroom integration:** Imports rosters directly from Google Classroom and exports formatted CSVs ready for Canvas and Moodle gradebooks.
- **Student Privacy & FERPA:** Reports save directly to the instructor's own Google Drive with zero third-party telemetry scraping.

We also published an objective comparison guide analyzing current tools and retired extensions:
https://attendancetracker.dev/best-google-meet-attendance-extensions.html

If you are updating faculty documentation this semester, linking to Attendance Tracker or our guide might save your instructors and help desk significant troubleshooting time.

Best regards,  
Derek Gallardo  
Founder, Attendance Tracker  
https://attendancetracker.dev

---

### Pitch 2: Universidad de Puerto Rico - Recinto de Río Piedras (DECEP)
*(Provided in Spanish for maximum conversion with the local instructional technology team)*  
**To:** `decep.rp@upr.edu`  
**Subject:** Actualización sobre la herramienta "Meet Attendance" recomendada en el portal de DECEP  

Estimado equipo de la Unidad de Educación en Línea y DECEP (UPRRP),

Revisando sus valiosos recursos y tutoriales para docentes sobre videoconferencias en Google Meet ("Instalando y explorando la extensión de Meet Attendance para Google Chrome"), noté que la guía continúa recomendando la extensión de terceros "Meet Attendance".

Quería compartirles una observación técnica importante: dicha extensión fue abandonada por su desarrollador en 2023. Al depender del raspado de código (DOM scraping) de la página web de Meet, falla constantemente cada vez que Google actualiza la interfaz, provocando pérdidas de listas de asistencia para los profesores.

Para resolver este problema, desarrollamos Attendance Tracker (https://attendancetracker.dev/asistencia-google-meet.html), un complemento oficial de Google Workspace Marketplace construido directamente sobre la API REST v2 oficial de Google Meet:
- **100% en español:** Totalmente adaptado para instructores y estudiantes hispanohablantes.
- **No se rompe con cambios visuales:** Al integrarse en el panel nativo de Actividades de Google Meet, no depende de la estructura HTML del navegador.
- **Compatible con Chromebooks y dispositivos institucionales:** No requiere instalar extensiones no autorizadas en el navegador Chrome.
- **Integración con Google Classroom y Moodle:** Sincroniza listas con Google Classroom y genera archivos CSV listos para el registro de calificaciones de Moodle.
- **Privacidad y Seguridad:** Los registros se guardan directamente en el Google Drive del profesor sin enviar datos a servidores externos.

Publicamos además una guía comparativa sobre las herramientas actuales y las extensiones retiradas:  
https://attendancetracker.dev/best-google-meet-attendance-extensions.html

Si están actualizando sus guías técnicas docentes este semestre, enlazar a Attendance Tracker o recomendar esta alternativa oficial evitará inconvenientes técnicos a sus profesores.

Saludos cordiales,  
Derek Gallardo  
Desarrollador, Attendance Tracker  
https://attendancetracker.dev/asistencia-google-meet.html

---

### Pitch 3: TCEA (Texas Computer Education Association)
**To:** `mguhlin@tcea.org`  
**CC:** `info@tcea.org`  
**Subject:** Update on Google Meet attendance tools in your TechNotes guide  

Hi Miguel,

I've followed your work on TCEA TechNotes for a long time. I was recently reading your guide on tracking virtual learner participation (https://blog.tcea.org/tracking-attendance-for-virtual-learners/) and noticed it recommends the "Meet Attendance" Chrome extension.

As you likely know from educator feedback, that extension (and similar DOM-scraping extensions from the 2020 era) was abandoned in 2023 and frequently breaks whenever Google adjusts Meet's web elements, leaving teachers stranded mid-class.

We built Attendance Tracker (https://attendancetracker.dev) specifically to give teachers a durable, non-breaking solution. It is an official Google Workspace Marketplace add-on built on the Google Meet REST API v2:
- Runs natively inside Google Meet's Activities panel—no browser extension installation needed, making it seamless on managed school district Chromebooks.
- Includes one-click Google Classroom roster syncing so teachers know who is present, late, or absent in real time.
- Exports cleanly formatted CSVs designed specifically for Canvas and Moodle gradebooks, as well as direct Google Sheets exports to Google Drive.
- Completely privacy compliant (FERPA/COPPA friendly, zero tracking scripts).

We put together an in-depth breakdown of the attendance tool landscape and why legacy extensions broke:  
https://attendancetracker.dev/best-google-meet-attendance-extensions.html

If you ever update the TechNotes article or do a roundup of modern Google Workspace tools for K-12 educators, linking to Attendance Tracker or our guide would be a great resource for your readers.

Best regards,  
Derek Gallardo  
Founder, Attendance Tracker  
https://attendancetracker.dev

---

### Pitch 4: Teq (OTIS for Educators)
**To:** `MatthewThaxter@teq.com`  
**CC:** `info@teq.com`  
**Subject:** Outdated Meet Attendance extension recommended on Teq's Google Meet guide  

Hi Matthew,

I was reviewing Teq's guide on Google Meet tools for educators (https://www.teq.com/blog/2020/05/chrome-extensions-to-benefit-your-google-meet/) and noticed the section recommending "Meet Attendance" by Claycodes.org.

Given Teq's role as a trusted PD partner for hundreds of school districts, I wanted to flag that Clay's extension was abandoned in early 2023. Teachers attempting to use it today regularly encounter broken captures following Meet UI changes, plus unexpected subscription prompts.

We created Attendance Tracker (https://attendancetracker.dev), an official Google Workspace add-on built directly on Google's Meet REST API v2. It solves the structural issues of legacy extensions:
- **No browser extension required:** Runs natively in the Meet side panel, so IT departments don't have to whitelist unvetted third-party Chrome extensions on student or teacher devices.
- **Roster reconciliation:** Automatically matches live participants against Google Classroom class lists.
- **Gradebook export:** Downloads directly to formatted Canvas, Moodle, and Google Sheets files saved in the teacher's Drive.
- **Privacy compliance:** Meets strict district data handling criteria (FERPA/COPPA compliant).

We also compiled an analysis of modern vs. retired Meet attendance extensions:  
https://attendancetracker.dev/best-google-meet-attendance-extensions.html

If you revisit that blog post or your OTIS Google Meet training modules, referencing Attendance Tracker could save teachers countless headaches with deprecated tools.

Best regards,  
Derek Gallardo  
Founder, Attendance Tracker  
https://attendancetracker.dev

---

### Pitch 5: Tech & Learning (Future B2B — DA 82)
**To:** `christine.weiser@futurenet.com`  
**CC:** `techlearning@futurenet.com`  
**Subject:** Outdated Google Meet attendance tool in Brian Nadel's guide  

Hi Christine and Tech & Learning Editorial Team,

I've long appreciated Tech & Learning's actionable guides for educators. I was recently reading Brian Nadel's article, "6 Tips for Teaching with Google Meet" (https://www.techlearning.com/how-to/6-tips-for-teaching-with-google-meet), and noticed Tip #4 recommends the "Meet Attendance" Chrome extension by Claycodes.org.

I wanted to flag a quick technical note: that extension was abandoned by its developer in early 2023. Because it relies on scraping Meet's web DOM elements, teachers attempting to use it today experience failed roll captures whenever Google updates Meet's UI (not to mention unexpected subscription billing prompts from the legacy developer portal).

Our team built Attendance Tracker (https://attendancetracker.dev), an official Google Workspace Marketplace add-on built natively on Google Meet's REST API v2. Because it connects via the official API rather than DOM scraping:
- It never breaks on Google Meet layout redesigns.
- It operates directly inside Google Meet's Activities panel—meaning zero browser extensions required, allowing it to run smoothly on managed school district Chromebooks.
- It syncs rosters with Google Classroom and exports formatted CSVs ready for Canvas and Moodle gradebooks.
- It respects student privacy laws (FERPA/COPPA compliant), saving records directly into the instructor's personal Google Drive.

We also published an objective comparison guide analyzing current tools and retired extensions:
https://attendancetracker.dev/best-google-meet-attendance-extensions.html

If you ever update the article or publish an updated roundup of modern Google Workspace tools for K-12 educators, linking to Attendance Tracker or our guide would provide your readers with a reliable, working solution.

Best regards,  
Derek Gallardo  
Founder, Attendance Tracker  
https://attendancetracker.dev

---

### Pitch 6: The Connecting Link (TCL)
**To:** `info@connectinglink.com`  
**Subject:** Outdated Google Meet attendance tool in online teaching resource  

Hi Connecting Link Team,

I was reading your article on "Facilitation of Successful Online Learning Experiences" and noted the recommendation of the "Chrome Meet Attendance extension by Claycodes.org".

Clay Codes ceased updating this extension in February 2023. Because it relies on scraping web elements from Google Meet, teachers using it now frequently experience failed attendance captures and broken sheets.

Our team developed Attendance Tracker (https://attendancetracker.dev), an official Google Workspace Marketplace add-on built on Google Meet's REST API v2. It operates directly in Meet's Activities panel, imports rosters from Google Classroom, exports cleanly formatted CSVs for Canvas and Moodle gradebooks, and preserves privacy by storing data directly in the instructor's Google Drive.

Our objective guide comparing current tools and retired extensions is available here:  
https://attendancetracker.dev/best-google-meet-attendance-extensions.html

If you refresh your course materials or online teaching pointers, linking to Attendance Tracker will provide your educators with a modern, active solution.

Best regards,  
Derek Gallardo  
Founder, Attendance Tracker  
https://attendancetracker.dev

---

### Pitch 7: Austin Community College (ACC) — Academic Technology NEXUS
**To:** `acctech@austincc.edu`  
**Subject:** Modern alternative for Google Meet attendance on Academic Technology NEXUS  

Hi ACC Academic Technology Team,

I was exploring your instructional technology resources on the Academic Technology NEXUS (https://instruction.austincc.edu/nexus/) regarding virtual class management with Google Meet.

Many faculty still rely on legacy Chrome extensions from 2020–2022 that break every time Google modifies the Meet UI.

We built Attendance Tracker (https://attendancetracker.dev), an official Google Workspace Marketplace add-on built on Google Meet's native REST API v2. It runs directly inside Meet's side panel without DOM scraping:
- Never breaks during Google Meet interface refreshes.
- Zero client installation: functions seamlessly on managed campus Chromebooks, PCs, and Macs.
- Direct LMS export: formatted CSVs ready for Blackboard and Canvas gradebooks.
- Privacy & FERPA compliant: attendance logs save to the instructor's Google Drive.

Full comparison of active tools vs. deprecated extensions:  
https://attendancetracker.dev/best-google-meet-attendance-extensions.html

If you are updating your synchronous teaching guides for faculty this term, linking to Attendance Tracker or our guide will give your instructors a reliable, stress-free attendance workflow.

Best regards,  
Derek Gallardo  
Founder, Attendance Tracker  
https://attendancetracker.dev

---

### Pitch 8: Cult of Pedagogy (Teacher's Guide to Tech — DA 74)
**To:** `editor@cultofpedagogy.com`  
**Subject:** Attendance Tracker for the Teacher's Guide to Tech (Replacing legacy Meet scrapers)  

Hi Jennifer,

I've been a longtime admirer of Cult of Pedagogy and your indispensable Teacher's Guide to Tech.

As you prepare updates for the directory, I wanted to introduce a modern solution to a persistent problem educators face: taking reliable attendance during synchronous Google Meet classes.

During 2020–2022, many teachers relied on DOM-scraping Chrome extensions (such as Clay Codes' Meet Attendance or Tyler & Adit's Attendance for Google Meet). Both tools were completely abandoned in 2023 and now fail with fatal errors because Meet updated its layout. Furthermore, school districts are increasingly blocking third-party Chrome extensions due to student data privacy compliance (FERPA/COPPA).

We built Attendance Tracker (https://attendancetracker.dev), an official Google Workspace Marketplace add-on built on Google Meet's REST API v2:
- **Native Integration:** Runs directly in Google Meet's Activities panel—requiring zero Chrome extensions, making it 100% functional on managed district Chromebooks.
- **Roster Sync:** Connects with Google Classroom to automatically flag Present, Late, and Absent students.
- **Gradebook Ready:** Exports formatted CSVs for Canvas and Moodle, and logs directly to Google Drive spreadsheets.
- **Privacy First:** Operates without ad trackers or third-party data collection.

We also compiled an analysis of modern vs. retired Meet attendance extensions:  
https://attendancetracker.dev/best-google-meet-attendance-extensions.html

I'd love for Attendance Tracker to be considered for inclusion in the next edition of the Teacher's Guide to Tech under Classroom Management / Video Conferencing.

Warm regards,  
Derek Gallardo  
Founder, Attendance Tracker  
https://attendancetracker.dev

---

## Part 3: Open EdTech Registry Submission Packages

### 1. MERLOT (merlot.org — DA 76)
*California State University's peer-reviewed collection of higher-ed digital learning materials.*

#### Submission Steps:
1. Visit [MERLOT.org](https://www.merlot.org) and click **Log In** (or create a free account).
2. Click **Contribute** in the top navigation -> select **Add a Material to MERLOT**.
3. Fill out the form fields using the exact package below:

#### MERLOT Submission Form Data:
* **Title:** `Attendance Tracker for Google Meet`
* **URL:** `https://attendancetracker.dev/`  
  *(Secondary URL / Alternate link: `https://workspace.google.com/marketplace/app/attendance_tracker/829771833968`)*
* **Primary Material Type:** `Learning Management Tool` *(or `Open Educational Tool` / `Simulation / Tool`)*
* **Secondary Material Type:** `Assessment Tool` / `Support Tool`
* **Primary Academic Discipline:** `Education` -> `Higher Education` / `Educational Technology` / `Distance Learning` / `Classroom Management`
* **Primary Audience:** `College General Education`, `Higher Education Faculty`, `Community College`, `K-12 Educators`, `Instructional Designers`
* **Language:** `English` *(Note in description: Interface fully localized in 30 languages including Spanish, Portuguese, French, Japanese, Korean, and German)*
* **Technical Requirements:** `Web Browser (Google Chrome, Firefox, Safari, Edge), Google Workspace account, Google Meet. Works natively on ChromeOS / managed Chromebooks without browser extensions.`
* **Cost:** `Free` *(Free tier available with core class roster features; low-cost one-time educator pass available)*
* **Copyright / License:** `Proprietary / Free Educational Use Tier Available (Official Google Workspace Marketplace Add-on)`
* **Author / Developer Name:** `Derek Gallardo`
* **Organization:** `Attendance Tracker`
* **Author Email:** `support@attendancetracker.dev`
* **Keywords / Tags:** `Google Meet, Attendance, Classroom Management, Google Classroom, Canvas LMS, Moodle, Remote Learning, Synchronous Teaching, Gradebook Export, Education Technology, FERPA`
* **Description / Abstract:**
```text
Attendance Tracker is an official Google Workspace Marketplace add-on engineered specifically for educators conducting synchronous virtual or hybrid classes in Google Meet. Unlike legacy third-party Chrome extensions that scrape the browser's Document Object Model (DOM) and frequently break during Google Meet interface redesigns, Attendance Tracker connects directly to the official Google Meet REST API v2.

Key Educational Features:
1. Native Side Panel Operation: Runs directly inside Google Meet's Activities panel across all browsers (Chrome, Edge, Firefox, Safari) and managed Chromebooks without requiring any browser extension installation.
2. Real-Time Roster Reconciliation: Integrates directly with Google Classroom to import rosters and display live Present, Late, and Absent statuses during class.
3. LMS Gradebook Export: Generates cleanly formatted CSV files tailored for one-click import into Canvas and Moodle gradebooks, as well as automatic exports to Google Sheets.
4. Privacy & Compliance: Fully FERPA and COPPA compliant. No advertising, zero third-party telemetry scraping, and all attendance logs are saved directly in the instructor's personal Google Drive.
5. Multilingual Support: Full UI localization into 30 languages.
```

---

### 2. EdSurge Product Index / ISTE EdTech Index (edsurge.com / iste.org — DA 84)
*The EdSurge Product Index is now officially administered as the **ISTE EdTech Index** via the **Learning Technology Directory (LTD)**.*

#### Submission Steps:
1. Go to the **ISTE EdTech Index** provider portal at [https://iste.org/edtech-index](https://iste.org/edtech-index) or the Learning Technology Directory (LTD).
2. Click **"Get Listed" / "Create Solution Provider Profile"** (or email `ltd-info@iste.org` to claim/create your company profile).
3. Select the **Basic Profile** (Free).
4. Register the product and complete the listing using the exact fields below:

#### EdTech Index Submission Form Data:
* **Product Name:** `Attendance Tracker`
* **Company / Developer Name:** `Attendance Tracker` (Developer: `Derek Gallardo`)
* **Company Website:** `https://attendancetracker.dev`
* **Product Marketplace URL:** `https://workspace.google.com/marketplace/app/attendance_tracker/829771833968`
* **Support Email:** `support@attendancetracker.dev`
* **Primary Category:** `Classroom Management & Administration`
* **Secondary Categories:** `Instructional Tools & Video Conferencing`, `Student Information & Attendance Tracking`
* **Grade Levels / Target Audience:** `Higher Education`, `High School (9-12)`, `Middle School (6-8)`, `Elementary (K-5)`, `Continuing Education / Adult Learning`
* **Short Description (50 words):**
```text
Attendance Tracker is an official Google Workspace Marketplace add-on built on the Google Meet REST API v2. It provides real-time roll capture, Google Classroom roster imports, and gradebook-formatted CSV exports for Canvas and Moodle directly inside Meet's side panel—with no browser extensions or DOM scraping required.
```
* **Long Description (250 words):**
```text
Attendance Tracker (https://attendancetracker.dev) provides a dependable, privacy-first attendance solution for K-12 and higher-education institutions utilizing Google Meet for remote and hybrid instruction. 

While historical browser extensions relied on scraping HTML elements from Google Meet—leading to frequent breakages during interface updates and security vulnerabilities on school-issued devices—Attendance Tracker functions as an authorized Google Workspace add-on built natively on Google's Meet REST API v2. It requires no local browser extension, allowing effortless deployment across student and teacher Chromebooks, Mac, Windows, and Linux environments.

Key capabilities for educators:
- Live Side-Panel Verification: View participant status (Present, Late, Absent, rejoins merged) in real time without leaving the meeting.
- LMS & Roster Integration: Import rosters from Google Classroom with a single click; download CSV files custom-formatted for Canvas and Moodle gradebooks.
- Data Privacy & FERPA Compliance: Zero external data harvesting or advertising. Session logs and attendance spreadsheets are saved directly to the instructor's personal Google Drive.
- Multi-Language Accessibility: Fully translated into 30 languages to support global and bilingual classrooms.
- Flexible Pricing: Free tier available for individual educators, with low-cost lifetime individual passes and site-wide department licenses.
```
* **Pricing Model:** `Freemium (Free tier available; Pro individual pass $9.99 one-time; Educator annual pass $4.99/yr; School/Department license $59/yr)`
* **Platforms Supported:** `Web-based, Google Workspace, Google Meet, ChromeOS (Chromebooks), Windows, macOS, Linux, iOS/Android (via browser)`
* **LMS & Cloud Integrations:** `Google Meet (REST API v2), Google Classroom, Google Drive, Google Sheets, Canvas LMS, Moodle LMS`
* **Privacy Policy URL:** `https://attendancetracker.dev/privacy.html`
* **Student Privacy Commitment URL:** `https://attendancetracker.dev/student-data-privacy.html`
* **Terms of Service URL:** `https://attendancetracker.dev/terms.html`
