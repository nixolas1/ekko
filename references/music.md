# Musikk fra referansevideoen

## Publisering — 18. oktober 2026

Eieren har uttrykkelig bekreftet tillatelse til å hoste de fem nåværende opptakene på den offentlige Vercel-siden. CLI-deploy inkluderer derfor `public/audio/`, mens filene fortsatt er Git-ignorert. Dette oppdaterer den tidligere avgrensningen til lokal demo for disse fem filene; det innebærer ikke en generell lisens for andre brukere av kildekoden. Avspilling starter fortsatt bare etter brukerhandling.

Verifisert 17. oktober 2026 fra den utvidede YouTube-beskrivelsen: **MitiS – Endeavors**. Videoen er «Particle tests (15) 3D Music Visualizer - Full HD», MatthiasM.de, publisert 12. februar 2013.

- Video: https://www.youtube.com/watch?v=fpViZkhpPHk
- Artistens låtside: https://soundcloud.com/mitis/mitis-endeavors-free-download
- Artistens gratislenke: https://theartistunion.com/tracks/4f388e

Artistens SoundCloud-side omtaler gratis nedlasting, men angir også **all-rights-reserved**. En gratis nedlasting er ikke dokumentasjon på fri viderepublisering eller utstillingslisens. Gjeldende NCS-status er ikke verifisert; ingen NCS-kreditering eller lisens er lagt til. NCS sin generelle brukspolicy er lest, men gir ikke i seg selv rettigheter til denne låten: https://ncs.io/usage-policy

Konkrete nedlastingsforsøk:

- The Artist Union: nettleseren viser 404 NoSuchKey for tracks/4f388e.
- Historisk SoundCloud /download-adresse: HTTP 410 Gone.
- EARMILKs historiske direkte MP3-lenke: serverforbindelsen feiler. Kildeside https://earmilk.com/2012/11/21/wobble-wednesday-81/; fil https://files2.earmilk.com/upload/mp3/2012-11/MitiS---Endeavors--EM1112.mp3
- Nettleserverktøyets støttede medienedlasting på YouTube-videoelementet feiler. Spillerens kilde er en blob-strøm, ikke en vanlig direkte lydfil.

**Lydfilen er nå hentet fra brukerens YouTube-lenke og integrert lokalt.** Ordinær yt-dlp 2026.8.19 med tilhørende EJS-pakke og Node ble kjørt i isolert `/tmp/ekko-media-tools`, uten cookies, innlogging, kjøp eller DRM-omgåelse. Format 251, Opus i WebM. Lokal fil: `/Users/nixo/project/gpkuk/public/audio/mitis-endeavors.webm` (ca. 3,54 MiB). Eksisterende system-ffmpeg har en manglende dylib, så original WebM-lyd er beholdt uten konvertering. Nettleserverifisering dokumenteres i verifikasjonsrapporten.

Låten ligger nå i det lokale musikkbiblioteket (se under) og lastes i samme Web Audio-kjede som lydfilinngangen. Filen er ignorert av Git og er til lokal demonstrasjon; ingen tillatelse til offentlig redistribusjon/utstillingsbruk er hevdet. `public/` kopieres av Vite til lokale bygg, så en eventuell fremtidig publisering må ta stilling til musikkrettigheter. Ingen publisering er utført.

Kreditering når låten eventuelt brukes: «MitiS – Endeavors», med lenke til artistens låtside. Dette er kildeangivelse, ikke en erstatning for nødvendige bruksrettigheter.

## Lokalt musikkbibliotek (lagt til 17. oktober 2026)

Lydpanelet har en nedtrekksliste «Lokal musikk» og en egen knapp «▶ Spill valgt låt». Katalogen er `src/music.js` (stabile id-er som lagres i `localStorage`).

- Valg i listen laster låten **pauset** fra start. Ingenting spilles før brukeren trykker på Spill-knappen.
- Ved ny lasting gjenopprettes valgt låt (`audio.track`) og avspillingsposisjon, alltid pauset. Gamle lagringer med `kind:'reference'` uten `track` tolkes som `mitis-endeavors`. Ukjente id-er faller tilbake til samme standard.
- «■ Stopp lyd», demopuls, mikrofon og opplasting øker `audioRevision` / AudioInputs operasjonsteller, så en låt som lastes i bakgrunnen blir forkastet og forblir stille.
- Opplasting av egen lydfil og mikrofon virker som før.

| id | Låt | Kilde (artistens/bandets verifiserte YouTube-kanal) | Lokal fil |
|---|---|---|---|
| `mitis-endeavors` | MitiS – Endeavors | Se over (referansevideoen) | `public/audio/mitis-endeavors.webm` |
| `mitis-shattered` | MitiS – Shattered (feat. RUNN) [Ophelia Records] | https://www.youtube.com/watch?v=lI5m0-oc9lI – kanal «MitiS» (@MitisMusic, UCYBRYn0sNtiGG5mQsNzhQ3g, verifisert), lastet opp 11.10.2019 | `public/audio/mitis-shattered.webm` (4,04 MiB) |
| `mitis-wilderness` | MitiS – Wilderness (feat. KC) | https://www.youtube.com/watch?v=waOuUycRRYs – kanal «MitiS» (samme kanal-id, verifisert), lastet opp 27.02.2026 | `public/audio/mitis-wilderness.webm` (3,82 MiB) |
| `aqua-doctor-jones` | Aqua – Doctor Jones | https://www.youtube.com/watch?v=-1jPUB7gRyg – kanal «Aqua» (@AquaVEVO, UCCiijV9YJmUtKSXOcxMqc_g, verifisert), lastet opp 24.02.2011, 3:23 | `public/audio/aqua-doctor-jones.webm` (3,20 MiB) |
| `polyphony-mc-nugget-yodel` | polyphony_digital – mc nugget yodel | https://www.youtube.com/watch?v=Jo2PuYWaNH8 – «polyphony_digital - Topic» (UC8COJCFo7RatCaUf3kkPKQw), en automatisk generert YouTube-kanal for artistens distribusjon. Beskrivelsen sier «Provided to YouTube by DistroKid», «℗ 12955882 Records DK» og «Released on: 2026-09-23». Offentlig, 2:06 | `public/audio/polyphony-digital-mc-nugget-yodel.webm` (2,06 MiB) |

«mc nugget yodel» er funnet med et offentlig YouTube-søk 17. oktober 2026. Det øverste treffet har nøyaktig samme tittel. Metadataene oppgir track `mc nugget yodel` og artist `polyphony_digital`, så tittelen er verifisert. Samme artist har lignende låter, som «mc fish yodel», «big mac mayo yodel» og «mc happy meal yodel». Ingen av dem er brukt som erstatning. Takeo Ischi «Chicken Yodeling» og «52 … Chicken Nuggets» er urelaterte og ble valgt bort. Filen er lastet ned på samme måte som de andre låtene, i format 251 (Opus i WebM), og `file` bekrefter WebM.

**Country Roads fjernet (17. oktober 2026, etter brukerens ønske):** `country-roads-dance` (Hermes House Band, https://www.youtube.com/watch?v=vOE3A3WM98k) og `country-roads-real-hypha` (Real Hypha Remix, https://www.youtube.com/watch?v=lYsiBSM5Wp4) er tatt ut av `LOCAL_TRACKS` og kredittlenkene. Filene er flyttet, ikke slettet, til `references/removed-audio/`, så de ikke lenger kopieres inn i bygget. Lagrede valg med disse id-ene faller tilbake til `mitis-endeavors`.

«Dr Jones» er tolket som Aqua – «Doctor Jones» (1997). Den valgte opplastingen er den offisielle musikkvideoen på Aquas egen verifiserte VEVO-kanal. Fan-opplastinger, liveopptak og TOTP-opptak ble valgt bort. Filen er lastet ned 17. oktober 2026 på samme måte som de andre låtene. Det er format 251 (Opus i WebM) uten konvertering, og `file` bekrefter WebM.

*Historikk (Country Roads er fjernet, se over):* «Take Me Home, Country Roads» er John Denvers låt. Søket fant ingen offisiell remiks fra John Denvers egne kanaler. Derfor ble Hermes House Bands egen dansversjon valgt. Den ligger på bandets egen verifiserte kanal. Remikser fra uoffisielle opplastere ble valgt bort fordi de ikke er offisielle kilder.

Korrigering 17. oktober 2026: Hermes House Band-versjonen er en danseversjon av en coverlåt, ikke en remiks. Den beholdes i biblioteket. I tillegg er en faktisk remiks lagt til: **Real Hypha Remix** (`country-roads-real-hypha`). Den ligger på remikserens egen offentlige kanal. Brukeren har godtatt det som artistkilde, så en opplasting fra John Denvers offisielle kanal er ikke nødvendig. Tittel, kanal, kanal-id, tilgjengelighet («public») og opplastingsdato er lest fra yt-dlp-metadata. Lydsporet er ikke lyttet gjennom. En remiks av en John Denver-innspilling er en bootleg uten bekreftet klarering. Gratis nedlasting fra remikseren gir derfor ingen rett til offentlig bruk. Bruk er kun til lokal demo.

Kanalnavn, kanal-id, verifiseringsstatus og opplastingsdato er lest fra YouTube-metadata med yt-dlp. Nedlastingsmetoden er den samme som for Endeavors: ordinær yt-dlp fra `/tmp/ekko-media-tools`, Node som JS-runtime, format 251 (Opus i WebM), uten cookies, innlogging eller omgåelse av tilgangskontroll. Det er ikke gjort noen konvertering, fordi ffmpeg er ødelagt. Alle filene ligger lokalt, så lydanalysen virker på dem. Ingen eksterne strømmer brukes.

Rettigheter: Filene er kun til lokal demonstrasjon, etter brukerens tillatelse. `public/audio/` er ignorert av Git. **Vite kopierer filene til `dist/audio/` ved bygging**, så de må fjernes eller lisensieres før offentlig bygg eller utstilling. Det er ikke hevdet noen rett til viderepublisering, og ingenting er publisert. Kreditering i appen er en kildelenke per låt (`data-track-credit` i `index.html`), ikke en lisens.

## Catalogue additions — 18 October 2026

Added at the user’s request using yt-dlp 2026.08.19 with Node, audio-only format 251 (Opus/WebM). These additions were downloaded locally; no production deployment was performed. Source metadata was checked against artist or label uploads. The recordings remain Git-ignored.

| Track | YouTube source | Duration | Local file |
| --- | --- | --- | --- |
| DJ Shadow — Scale It Back (feat. Little Dragon) | [djshadow](https://www.youtube.com/watch?v=NL9ypNz9-mM) | 4:21 | `/audio/dj-shadow-scale-it-back.webm` |
| Alec Troniq & Gabriel Vitel — Pimpernuckel | [Alec Troniq](https://www.youtube.com/watch?v=VG6ADGAVmDs) | 4:03 | `/audio/alec-troniq-pimpernuckel.webm` |
| TheFatRat — Unity | [TheFatRat](https://www.youtube.com/watch?v=n8X9_MgEdCg) | 4:09 | `/audio/thefatrat-unity.webm` |
| Will Sparks — Ah Yeah! | [TMRW Music](https://www.youtube.com/watch?v=VhFvRGK4pVY) | 3:33 | `/audio/will-sparks-ah-yeah.webm` |
| Otto Knows — Million Voices | [Otto Knows](https://www.youtube.com/watch?v=S8jhXmfdRFY) | 3:09 | `/audio/otto-knows-million-voices.webm` |
| Jamie xx — Loud Places (feat. Romy) | [Jamie xx](https://www.youtube.com/watch?v=kuOe4haCNgA) | 4:43 | `/audio/jamie-xx-loud-places.webm` |
| D A N N Y — TAKE ME | [broke records](https://www.youtube.com/watch?v=2YcPf0a4n0Q) | 2:09 | `/audio/danny-take-me.webm` |
| Felix Da Housecat — Rocket Ride | [Felix Da Housecat](https://www.youtube.com/watch?v=nfKrZbBEKWY) | 2:41 | `/audio/felix-da-housecat-rocket-ride.webm` |
| Fred again.. & Blanco — solo | [Fred again . .](https://www.youtube.com/watch?v=WgHndN5nThc) | 4:52 | `/audio/fred-again-solo.webm` |
| Porter Robinson & Madeon — Shelter | [Madeon](https://www.youtube.com/watch?v=HQnC1UHBvWA) | 3:38 | `/audio/porter-robinson-madeon-shelter.webm` |
| Madeon — Icarus | [Madeon](https://www.youtube.com/watch?v=XHs99iVpnXU) | 3:37 | `/audio/madeon-icarus.webm` |
| Mansionair — Violet City | [Mansionair](https://www.youtube.com/watch?v=miC82O_a5GI) | 3:29 | `/audio/mansionair-violet-city.webm` |
| The Acid — Basic Instinct (Thomas Jack Remix) | [Thomas Jack](https://www.youtube.com/watch?v=cd_Kw-CU8fU) | 6:28 | `/audio/the-acid-basic-instinct-thomas-jack.webm` |
| Guru Josh Project — Infinity 2008 (Klaas Vocal Mix) | [Ultra Records](https://www.youtube.com/watch?v=jzy2dgEUOhY) | 3:14 | `/audio/guru-josh-project-infinity.webm` |
| deadmau5 & Kaskade — I Remember | [deadmau5](https://www.youtube.com/watch?v=zK1mLIeXwsQ) | 9:54 | `/audio/deadmau5-kaskade-i-remember.webm` |
| 旱獭乐队 — Ezir-Kara (骏马黑鹰) | [旱獭乐队 - Topic](https://www.youtube.com/watch?v=AAuEAYa19K8) | 2:43 | `/audio/marmota-ezir-kara.webm` |
| Emma Jensen — Somebody Else (The 1975 cover, P3 Christine Live) | [NRK P3](https://www.youtube.com/watch?v=VxlQG8s24zI) | 3:25 | `/audio/emma-jensen-somebody-else.webm` |

“project guru” is matched to Guru Josh Project; “deadm5us” to deadmau5. “Basic Instinct” is The Acid’s Thomas Jack remix. “Rocket Ride” uses the original, and “I Remember” uses the full-length recording. “Ezir-Kara” uses the exact YouTube recording supplied by the user (AAuEAYa19K8), with artist/title taken from its distribution metadata. “I was dreaming of the past” was omitted at the user’s request.

Emma Jensen’s recording uses the exact video supplied by the user, VxlQG8s24zI. Its YouTube title identifies it as a live cover of The 1975 for P3 Christine Live; the catalogue preserves that version information. Downloaded as format 251 with yt-dlp, without the radio playlist parameters.

The user requested deployment of the expanded catalogue on 18 October 2026. The release packages all 22 installed recordings (the original five plus 17 additions).
