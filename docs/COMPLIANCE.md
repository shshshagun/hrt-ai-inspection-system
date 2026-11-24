# Compliance Notes

Status of privacy, legal, licence and IEEE-standard compliance for the HRT AI Inspection System, as of 19 November 2026.

> This is an engineering record, not legal advice. It describes what the software and its pages do today and what is still open. The standards below are paywalled and were mapped from general knowledge, not read line by line: check each against the current edition before citing it in the report or relying on it.

## 1. What was added

| Item | Where |
|---|---|
| Privacy Policy, Terms of Use, Cookie page | `/privacy`, `/terms`, `/cookies` (`frontend/src/pages/legal/`) |
| Cookie and storage notice with a real choice | `frontend/src/ui/CookieBanner.jsx`, `consent.js` |
| Footer and sign-in links to the legal pages; "By creating an account you agree…" on sign-up | `LegalLinks.jsx`, `Register.jsx`, `Login.jsx`, `ForgotPassword.jsx`, landing footer |
| Fonts served from our own site (no request to Google) | `frontend/public/fonts/` |
| Editable contact and version details | `frontend/src/config/legal.js` |
| MIT licence file (the README badge already claimed MIT) | `LICENSE` |

## 2. Cookies and browser storage

The app sets **no cookies** and has no analytics or advertising code. Browser storage in use:

| Key | Storage | Purpose | Consent |
|---|---|---|---|
| `hrt_auth_token` | session | sign-in token | not needed (strictly necessary) |
| `hrt_demo` | session | demo flag | not needed |
| `hrt-intro-seen` | session | skip landing intro | not needed (short-lived display setting) |
| `hrt-consent` | local | the visitor's choice | not needed (records the choice) |
| `hrt-theme` | local | light/dark | **consent**: saved only after "Remember my preferences"; "Essential only" deletes it |

The notice offers two equal choices, and the choice is reversible from the footer ("Cookie settings") and the Cookies page. Because nothing non-essential beyond the theme exists, there is no tracking-consent banner to fake. **If analytics, maps or embeds are ever added, update the table, the policy and the banner first.**

Google Fonts were previously loaded from Google's servers, which sends every visitor's IP address to Google. They are now self-hosted (SIL Open Font License; Anton, Inter, IBM Plex Mono, Space Grotesk, JetBrains Mono, Latin subset).

## 3. Privacy-law map

| Requirement | Status |
|---|---|
| **India, DPDP Act 2023** and its rules: notice, purpose, consent, rights, grievance contact | Notice and grievance contact on `/privacy`; consent is by notice at sign-up. **Open:** confirm the current rules (notice wording, consent manager, breach reporting, children's data) with a lawyer before real use |
| **GDPR / UK GDPR** (only if EEA/UK users): lawful bases, rights, transfers, processors | Bases and rights listed on `/privacy`. **Open:** no signed data-processing agreements or transfer mechanisms with the hosts (Vercel, Render, MongoDB Atlas, Google, Groq, SMTP provider); no record of processing; no DPIA |
| **ePrivacy / cookie rules** | Met by the design in section 2 |
| **IT Act 2000 s.43A and SPDI Rules 2011**, **CERT-In directions (2022)** | Passwords hashed, access control, HTTPS. **Open:** CERT-In asks for incident reporting within 6 hours and 180-day log retention for covered entities; there is no incident-response runbook |
| Data minimisation | Only name, e-mail and password hash per user; assistant receives no names, e-mails, images or notes; video stays in the browser |
| Security of processing | bcrypt, signed expiring JWTs, role checks on the server, rate limits, Helmet headers, uniform answers on login and reset, HMAC-hashed single-use reset codes, 12 password-reset tests |

### Known gaps (honest list)

1. **No self-service export or deletion of a user's data.** Requests are handled by e-mail and by hand. Building `GET /api/auth/me/export` and `DELETE /api/auth/me` would close this.
2. **No automated retention.** Detections and accounts stay until deleted. Reset-code expiry is enforced; nothing else expires.
3. **No audit log of who read or changed personal data.**
4. **Server logs sit with the hosts**; their retention is not configured here.
5. **No recorded proof of consent** beyond the sign-up notice (no timestamped consent record).
6. **Defect snapshots could show people** if footage is not of an empty tunnel. The policy tells users not to include them.
7. **The free-tier AI providers may use prompts to improve their products.** Only defect data is sent; keep it that way or move to a paid plan with a no-training term.

## 4. Licences and attributions to check

| Component | Licence | Action |
|---|---|---|
| **Ultralytics YOLOv8** (and the YOLOv8n-seg weights trained with it) | **AGPL-3.0** (or a paid Enterprise licence) | The deployed model embeds Ultralytics metadata. AGPL obliges you to offer corresponding source to network users and to license derivative works under AGPL; this repo is MIT. **Decide:** keep the repo AGPL-compatible, obtain an Enterprise licence, or swap the model. Needs a lawyer or your guide's view |
| Roboflow *Underwater Crack Detection v3* dataset | CC BY 4.0 (per `data/data.yaml`) | Attribute it (README references section does; keep it) |
| Three.js, React, Vite and other npm dependencies | mostly MIT/ISC/Apache-2.0 | Run a licence scan (e.g. `npx license-checker`) before distributing |
| Fonts | SIL OFL 1.1 | Fine to self-host; keep the licence text if redistributing the font files |
| Source repository | MIT (`LICENSE` added) | Resolve the AGPL point above first |

## 5. IEEE standards and conventions that apply

| Standard | Relevance here | Status |
|---|---|---|
| **IEEE Code of Ethics** (IEEE Policy 7.8) | Public safety, honesty about limits, credit to others | Followed: the README and Terms state that the model was not trained by the team, has recall 0.53, and must be engineer-reviewed |
| **IEEE 7000-2021** (addressing ethical concerns in system design) | Safety-critical infrastructure decisions; stakeholder values | Partly: values and risks are in the Terms and Limitations. A short value-elicitation table would complete it |
| **IEEE 7001-2021** (transparency of autonomous systems) | Explaining what the AI does and why | Partly: provenance, metrics and review requirement are documented; the report-draft number check is a transparency control |
| **IEEE 7002-2022** (data privacy process) | Privacy-by-design process | This document and `/privacy` are the start; a data-flow diagram would complete it |
| **IEEE 7003-2024** (algorithmic bias) | Dataset and model coverage | Partly: limitation to clear-water crack images is documented |
| **ISO/IEC/IEEE 29119** (software testing; replaces IEEE 829) | Test documentation | Four-tier test suite exists; test plan and test case table are in the report |
| **IEEE 1012** (verification and validation) | V&V planning | Partly: verification suite exists; validation on real tunnel footage is missing |
| **ISO/IEC/IEEE 12207, 29148, 42010** | Life cycle, requirements, architecture description | Report follows analysis → design → test; viewpoints are the UML diagrams |
| **IEEE citation style** | Report references | The report uses numbered IEEE-style references (`[1]`, author, title, source, year). Add access dates to the online ones |
| **Project report format** (SVVV) | Layout of the submitted report | Applied in `Report_6_A-G1_v3.docx` |

## 6. Before real deployment

1. Fill in `frontend/src/config/legal.js` with the real operator name and contact.
2. Have a qualified person review the three legal pages for your jurisdiction.
3. Sign or accept the processors' data-processing terms (Vercel, Render, MongoDB Atlas, the SMTP provider, Google/Groq if enabled).
4. Settle the Ultralytics licence question.
5. Add account export and deletion, and an incident-response runbook.
6. Run an accessibility check (WCAG 2.1 AA); none has been done.
