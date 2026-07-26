import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

const defaultScheduleBlocks = [
  { key: 'subahi', label: 'Subahi', start_time: '05:00', end_time: '07:00' },
  { key: 'morning', label: 'Morning', start_time: '09:00', end_time: '12:45' },
  { key: 'afternoon', label: 'Afternoon', start_time: '14:30', end_time: '16:30' },
  { key: 'evening', label: 'Evening', start_time: '19:30', end_time: '20:45' },
  { key: 'night', label: 'Night', start_time: '21:30', end_time: '23:00' },
];
function displayTime(time) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time || '')) return '--:--';
  const [hours, minutes] = time.split(':').map(Number);
  const suffix = hours >= 12 ? 'PM' : 'AM';
  return `${hours % 12 || 12}:${String(minutes).padStart(2, '0')} ${suffix}`;
}
function getScheduleGroups(blocks) {
  const saved = new Map((Array.isArray(blocks) ? blocks : []).map(block => [block.key, block]));
  return defaultScheduleBlocks.map(defaultBlock => {
    const block = { ...defaultBlock, ...(saved.get(defaultBlock.key) || {}) };
    return { ...block, range: `${displayTime(block.start_time)} - ${displayTime(block.end_time)}`, min: block.start_time, max: block.end_time, defaultTime: block.start_time };
  });
}
const routes = {
  '/': 'home',
  '/scoreboard': 'scoreboard',
  '/schedule': 'schedule',
  '/participants': 'participants',
  '/musabaqa': 'musabaqa',
  '/review': 'review',
  '/admin': 'admin',
};

const musabaqaPrograms = [
  { group:'Off stage', number:1, program:'Calligraphy', responsibility:'Zafeerudheen Usthad' },
  { group:'Off stage', number:2, program:'News Writing', responsibility:'Saad Usthad' },
  { group:'Off stage', number:3, program:'Malayalam Leganam', responsibility:'Midlaj Usthad' },
  { group:'Off stage', number:4, program:'Arabic Leganam', responsibility:'To be assigned' },
  { group:'Off stage', number:5, program:'Poem Writing', responsibility:'Abdul Samad Usthad' },
  { group:'On stage', number:6, program:'Malayalam Speech', responsibility:'Answaf Usthad' },
  { group:'On stage', number:7, program:'English Speech', responsibility:'Mahmood Usthad' },
  { group:'On stage', number:8, program:'Arabic Speech', responsibility:'Jamaludheen Usthad' },
  { group:'On stage', number:9, program:'Urdu Speech', responsibility:'Yakoob Usthad' },
  { group:'On stage', number:10, program:'Qirath (Thartheel, Thadveer)', responsibility:'Qari Salman, Qari Bilal' },
  { group:'On stage', number:11, program:'Urdu Song', responsibility:'Qari Salman, Qari Bilal' },
  { group:'On stage', number:12, program:'Ebaarath Vazhana', responsibility:'Bilal Usthad' },
  { group:'On stage', number:13, program:'Muhadasa (Arabic, English)', responsibility:'Asif Usthad, Hassan Usthad' },
  { group:'On stage', number:14, program:'Padapayat', responsibility:'Adhil Usthad' },
  { group:'On stage', number:15, program:'Musagala', responsibility:'Abid Usthad' },
];

const musabaqaCommittee = [
  { role:'Ameer', members:'Ilyas Usthad, Answaf Usthad' },
  { role:'Program Committee', members:'Noorulla Usthad, Adhil Usthad, Abid Usthad (H), Ilyas Usthad, Answaf Usthad, Ajmal Usthad, Midlaj Usthad' },
  { role:'Stage & Mic', members:'Noorulla Usthad, Ajmal Usthad, Abid Usthad' },
  { role:'Paper Work', members:'Midlaj Usthad, Adhil Usthad' },
  { role:'Mark', members:'Answaf Usthad' },
  { role:'Monitoring', members:'Ilyas Usthad, Ajmal Usthad' },
  { role:'Prize', members:'Noorulla Usthad, Ilyas Usthad, Answaf Usthad' },
  { role:'MC', members:'Student of Thakasus' },
];

function pageForPath(pathname) {
  const path = pathname.replace(/\/+$/, '') || '/';
  const direct = routes[path];
  if (direct) return direct;
  const leaf = `/${path.split('/').filter(Boolean).at(-1) || ''}`;
  return routes[leaf] || null;
}

function pageFromLocation() {
  return pageForPath(window.location.pathname);
}

function publicHref(page) {
  return page === 'home' ? '/' : `/${page}`;
}

function apiEndpoint(resource) {
  return `/api?resource=${encodeURIComponent(resource)}`;
}

function readInitialData() {
  const root = document.getElementById('react-root');
  if (!root) return { page: 'home' };
  try {
    return JSON.parse(document.getElementById('initial-data')?.textContent || '{}');
  } catch {
    return { page: root.dataset.page || 'home' };
  }
}

async function getResource(resource) {
  const response = await fetch(apiEndpoint(resource), { cache: 'no-store', headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Failed to load ${resource}`);
  const payload = await response.json();
  return payload.data || [];
}

async function submitReview(payload) {
  const response = await fetch(apiEndpoint('reviews'), {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Your review could not be saved. Please try again.');
  return result.data;
}

async function adminRequest(resource, method, payload) {
  const requestId = `${resource}-${Date.now()}`;
  const resourceLabels = { scores:'score', teams:'team', programs:'program', participants:'participant', students:'student record', reviews:'reviews', settings:'website settings', 'schedule-blocks':'schedule time' };
  const action = method === 'GET' ? 'Loading' : method === 'DELETE' ? 'Deleting' : method === 'POST' ? 'Publishing' : 'Saving';
  window.dispatchEvent(new CustomEvent('admin-request-start', { detail: { requestId, message:`${action} ${resourceLabels[resource] || 'changes'}…` } }));
  try {
    const response = await fetch(apiEndpoint(resource), {
      method,
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: method === 'GET' ? undefined : JSON.stringify(payload || {}),
    });
    const result = await response.json().catch(() => ({}));
    if (response.status === 401) window.dispatchEvent(new CustomEvent('admin-session-expired'));
    if (!response.ok) throw new Error(result.error || 'The update could not be completed');
    if (method !== 'GET') {
      window.dispatchEvent(new CustomEvent('festival-data-changed', { detail: { resource } }));
    }
    try { if (method !== 'GET') {
      window.localStorage.setItem('festival-data-version', `${Date.now()}:${resource}`);
      const channel = new BroadcastChannel('festival-live-data');
      channel.postMessage({ resource });
      channel.close();
    }} catch {}
    return result.data;
  } finally {
    window.dispatchEvent(new CustomEvent('admin-request-end', { detail: { requestId } }));
  }
}

async function uploadTeamImage(teamId, file) {
  const requestId = `team-image-${Date.now()}`;
  window.dispatchEvent(new CustomEvent('admin-request-start', { detail:{ requestId, message:'Uploading team image…' } }));
  try {
    const form = new FormData();
    form.append('team_id', teamId);
    form.append('image', file);
    const response = await fetch(apiEndpoint('team-image'), { method:'POST', credentials:'same-origin', headers:{ Accept:'application/json' }, body:form });
    const result = await response.json().catch(() => ({}));
    if (response.status === 401) window.dispatchEvent(new CustomEvent('admin-session-expired'));
    if (!response.ok) throw new Error(result.error || 'The team image could not be uploaded');
    window.dispatchEvent(new CustomEvent('festival-data-changed', { detail:{ resource:'teams' } }));
    try {
      window.localStorage.setItem('festival-data-version', `${Date.now()}:teams`);
      const channel = new BroadcastChannel('festival-live-data'); channel.postMessage({ resource:'teams' }); channel.close();
    } catch {}
    return result.data;
  } finally { window.dispatchEvent(new CustomEvent('admin-request-end', { detail:{ requestId } })); }
}

function useFestivalData(initial, page) {
  const [data, setData] = useState({
    teams: initial.teams || [],
    schedule: initial.schedule || [],
    participants: initial.participants || [],
    students: initial.students || [],
    settings: initial.settings || {},
  });

  useEffect(() => {
    let active = true;
    const applyTeams = teams => {
      if (!active) return;
      setData(current => JSON.stringify(current.teams) === JSON.stringify(teams) ? current : { ...current, teams });
    };
    const loadScores = () => getResource('scoreboard').then(applyTeams).catch(() => {});
    const loadAll = () => Promise.all([getResource('scoreboard'), getResource('schedule'), getResource('participants'), getResource('settings')])
      .then(([teams, schedule, participants, settings]) => { if (active) setData(current => ({ ...current, teams, schedule, participants, settings })); })
      .catch(() => {});
    const loadChangedResource = event => {
      const resource = event?.detail?.resource || event?.data?.resource;
      if (resource === 'scores' || resource === 'teams') return loadScores();
      if (resource === 'settings') return getResource('settings').then(settings => active && setData(current => ({ ...current, settings }))).catch(() => {});
      if (resource === 'programs' || resource === 'schedule-blocks' || resource === 'program-status') return getResource('schedule').then(schedule => active && setData(current => ({ ...current, schedule }))).catch(() => {});
      if (resource === 'participants') return getResource('participants').then(participants => active && setData(current => ({ ...current, participants }))).catch(() => {});
      if (resource === 'students') return getResource('student-directory').then(students => active && setData(current => ({ ...current, students }))).catch(() => {});
      return loadAll();
    };
    const loadStoredChange = event => {
      if (event.key !== 'festival-data-version') return;
      String(event.newValue || '').endsWith(':scores') ? loadScores() : loadAll();
    };
    const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('festival-live-data') : null;
    channel?.addEventListener('message', loadChangedResource);
    window.addEventListener('festival-data-changed', loadChangedResource);
    window.addEventListener('storage', loadStoredChange);
    return () => {
      active = false;
      channel?.close();
      window.removeEventListener('festival-data-changed', loadChangedResource);
      window.removeEventListener('storage', loadStoredChange);
    };
  }, []);

  useEffect(() => {
    let active = true;
    if (page === 'schedule') getResource('schedule')
      .then(schedule => { if (active) setData(current => ({ ...current, schedule })); }).catch(() => {});
    if (page === 'participants') Promise.all([
      getResource('participants'),
      getResource('student-directory'),
    ]).then(([participants, students]) => {
      if (!active) return;
      setData(current => ({ ...current, ...(participants ? { participants } : {}), ...(students ? { students } : {}) }));
    }).catch(() => {});
    return () => { active = false; };
  }, [page]);

  useEffect(() => {
	if (page !== 'scoreboard' && page !== 'admin') return undefined;
    let active = true;
    let loading = false;
    const refreshDelay = page === 'scoreboard' ? 5000 : 10000;
    const refreshScores = async () => {
      if (!active || loading || document.hidden) return;
      loading = true;
      try {
        const teams = await getResource('scoreboard');
        if (!active) return;
        setData(current => JSON.stringify(current.teams) === JSON.stringify(teams) ? current : { ...current, teams });
      } catch {} finally {
        loading = false;
      }
    };
    const refreshWhenVisible = () => { if (!document.hidden) refreshScores(); };
    const initialRefresh = window.setTimeout(refreshScores, 900);
    const interval = window.setInterval(refreshScores, refreshDelay);
    window.addEventListener('focus', refreshScores);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      active = false;
      window.clearTimeout(initialRefresh);
      window.clearInterval(interval);
      window.removeEventListener('focus', refreshScores);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [page]);

  return data;
}

function useClock(withSeconds = false) {
  const formatter = useMemo(() => new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: withSeconds ? '2-digit' : undefined,
    hour12: false,
  }), [withSeconds]);
  const [time, setTime] = useState(() => formatter.format(new Date()));

  useEffect(() => {
    const id = window.setInterval(() => setTime(formatter.format(new Date())), withSeconds ? 15000 : 30000);
    return () => window.clearInterval(id);
  }, [formatter, withSeconds]);

  return time;
}

function PageHero({ overline, title, copy, label }) {
  return (
    <section className="page-hero compact section-wrap reveal visible">
      <div>
        <p className="overline">{overline}</p>
        <h1 dangerouslySetInnerHTML={{ __html: title }} />
      </div>
      <div className="page-intro">
        <p>{copy}</p>
        {label ? <span className="live-label"><i /> {label}</span> : null}
      </div>
    </section>
  );
}

function ButtonLink({ href, variant, children }) {
  return <a className={`button ${variant} magnetic`} href={href}>{children}</a>;
}

function Home({ data, visitor }) {
  const iconStudent = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>';
  const iconTeacher = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>';
  const iconBook = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"></path></svg>';
  const iconExam = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="7"></circle><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"></polyline></svg>';
  const eventHighlights = [
    { mark:'ق', title:'Qur’an & Recitation', copy:'Celebrating memorisation, precise Tajweed and the beauty of Qur’anic recitation.' },
    { mark:'◉', title:'Oratory & Expression', copy:'Inspiring confident voices through thoughtful speeches, debates and presentations.' },
    { mark:'◆', title:'Islamic Knowledge', copy:'Exploring the Qur’an, Seerah and Islamic heritage through engaging challenges.' },
    { mark:'✎', title:'Language & Literature', copy:'Showcasing imagination through Arabic, Malayalam and creative writing.' },
  ];

  return (
    <div className="home-redesign">
      <section className="home-redesign-hero">
        <div className="home-redesign-copy reveal visible">
          <p className="home-visitor-greeting">Welcome, <strong>{visitor}</strong></p>
          <p className="home-hero-eyebrow">Faith · Knowledge · Creativity</p>
          <h1>Kauzariyya<br /><em>Arts Festival.</em></h1>
          <p className="home-hero-intro">A celebration where students discover their voice, share their talent and grow through meaningful competition.</p>
        </div>
      </section>

      <section className="home-platform-statement section-wrap reveal visible" aria-label="About the Kauzariyya competition platform">
        <p>Competing in excellence, growing in knowledge, and standing together in faith. The official digital platform for Kauzariyya’s student competitions, live scores, schedules, teams and results.</p>
        <strong>Excellence through knowledge <i /> Unity through faith <i /> Success through sincerity</strong>
      </section>

      <section className="home-musabaqa-about section-wrap reveal visible" aria-labelledby="musabaqa-about-title">
        <article className="home-about-copy">
          <p className="overline">About the Musabaqa</p>
          <h2 id="musabaqa-about-title">A stage for knowledge, discipline and sincere competition.</h2>
          <p>The Kauzariyya Musabaqa is an annual academic and Islamic competition organized by Al Jamiathul Kauzariyya Arabic College. It gives students an opportunity to demonstrate excellence in Qur’an, Hadith, Arabic, Islamic studies, speeches, recitation, literature and co-curricular activities.</p>
          <p>More than a competition, it strengthens brotherhood, confidence, discipline and character while celebrating the talents Allah has placed in every student.</p>
        </article>
        <aside className="home-musabaqa-prayer">
          <span lang="ar" dir="rtl">بِسْمِ اللهِ الرَّحْمٰنِ الرَّحِيْمِ</span>
          <p>May this gathering become a means of seeking beneficial knowledge, strengthening Islamic values and encouraging every participant to strive for excellence with sincerity.</p>
        </aside>
      </section>

      <section className="home-story section-wrap reveal visible">
        <figure className="home-story-visual">
          <img src="/assets/kauzariyya4.webp" alt="Kauzariyya Islamic College campus" loading="lazy" decoding="async" />
          <figcaption>Al Jamiathul Kauzariyya · Edathala</figcaption>
        </figure>
        <div className="home-story-content">
          <p className="home-story-kicker">More than a competition</p>
          <h2>Knowledge in action.<br />Character in every moment.</h2>
          <p className="home-story-copy">Kauzariyya brings recitation, scholarship, language, creativity and teamwork onto one stage—giving every student a chance to prepare deeply, perform bravely and grow together.</p>
          <blockquote className="home-story-verse">
            <header className="home-story-verse-head">
              <span>Qur’anic inspiration</span>
              <b aria-label="Verse 26">83 : 26</b>
            </header>
            <p lang="ar" dir="rtl">
              <span style={{ '--verse-word': 0 }}>وَفِي</span>{' '}
              <span style={{ '--verse-word': 1 }}>ذَٰلِكَ</span>{' '}
              <span style={{ '--verse-word': 2 }}>فَلْيَتَنَافَسِ</span>{' '}
              <span style={{ '--verse-word': 3 }}>الْمُتَنَافِسُونَ</span>
            </p>
            <footer>
              <span>“For this, let the competitors compete.”</span>
              <cite>Surah Al-Mutaffifin</cite>
            </footer>
          </blockquote>
        </div>
      </section>

      <section className="home-access section-wrap" aria-labelledby="home-access-title">
        <header>
          <div><p>Festival access</p><h2 id="home-access-title">One festival.<br /><em>Everything in reach.</em></h2></div>
          <span>Move through results, programmes, participants and feedback from one clear festival hub.</span>
        </header>
        <div className="home-access-grid">
          <FeatureCard number="01" icon={iconBook} href="/scoreboard" title="Live scoreboard" copy="Follow verified team standings as every result arrives." />
          <FeatureCard number="02" icon={iconTeacher} href="/schedule" title="Programme schedule" copy="See session times, categories and reporting details." />
          <FeatureCard number="03" icon={iconStudent} href="/participants" title="Participants" copy="Find every student, team and programme entry." />
          <FeatureCard number="04" icon={iconExam} href="/review" title="Share a review" copy="Tell us about your Kauzariyya festival experience." />
        </div>
      </section>

      <section className="home-event-highlights section-wrap reveal visible" aria-labelledby="home-highlights-title">
        <header><p className="overline">Event highlights</p><h2 id="home-highlights-title">Where faith, knowledge and creativity take the stage.</h2></header>
        <div>{eventHighlights.map((item,index)=><article key={item.title}><span>{item.mark}</span><small>0{index+1}</small><h3>{item.title}</h3><p>{item.copy}</p></article>)}</div>
      </section>

    </div>
  );
}

function FestivalStatus({ liveItem, participants, programs, progress, className = '' }) {
  return <section className={`festival-status-strip section-wrap reveal visible ${className}`.trim()} aria-label="Festival status">
    <a className="festival-status-live" href="/schedule">
      <i aria-hidden="true" />
      <span><small>{liveItem?.status === 'live' ? 'Live now' : 'Up next'}</small><strong>{liveItem?.title || 'Festival program'}</strong></span>
      <time>{liveItem?.start_time || '—'}</time>
    </a>
    <div className="festival-status-metrics">
      <span><strong>{participants}</strong><small>Participants</small></span>
      <span><strong>{programs}</strong><small>Programs</small></span>
      <span><strong>{progress}%</strong><small>Completed</small></span>
    </div>
  </section>;
}

function FeatureCard({ icon, href, title, copy, number }) {
  return (
    <a className="feature-card reveal visible" href={href}>
      <div><span className="card-icon" dangerouslySetInnerHTML={{ __html: icon }} /><small>{number}</small></div>
      <span className="card-copy"><h3>{title}</h3><p>{copy}</p></span>
      <b aria-hidden="true">↗</b>
    </a>
  );
}

function ScorePercentage({ score, maxScore = 100, className = '' }) {
  const numericScore = Number(score) || 0;
  const numericMax = Math.max(Number(maxScore) || 0, 1);
  const percentage = Math.max(0, Math.min(100, numericScore / numericMax * 100));
  const roundedPercentage = Math.round(percentage);

  return <div className={`score-percentage ${className}`.trim()}>
    <span className="score-percentage-track" role="progressbar" aria-label={`${roundedPercentage}% score achieved`} aria-valuemin="0" aria-valuemax="100" aria-valuenow={roundedPercentage}>
      <i style={{ width: `${percentage}%` }} />
    </span>
    <strong>{roundedPercentage}%</strong>
  </div>;
}

function ScoreBar({ score, maxScore = 100, className = '' }) {
  const numericScore = Number(score) || 0;
  const numericMax = Math.max(Number(maxScore) || 0, 1);
  const percentage = Math.max(0, Math.min(100, numericScore / numericMax * 100));
  const roundedPercentage = Math.round(percentage);

  return <span
    className={`score-dual-bar ${className}`.trim()}
    role="progressbar"
    aria-label={`${roundedPercentage}% score achieved`}
    aria-valuemin="0"
    aria-valuemax="100"
    aria-valuenow={roundedPercentage}
  ><i style={{ width: `${percentage}%` }} /></span>;
}

function Scoreboard({ teams, settings = {} }) {
  const updateFormatter = useMemo(() => new Intl.DateTimeFormat('en-GB', { hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false }), []);
  const [updated, setUpdated] = useState(() => updateFormatter.format(new Date()));
  useEffect(() => setUpdated(updateFormatter.format(new Date())), [teams, updateFormatter]);
  const ordered = [...teams].sort((a, b) => Number(b.score) - Number(a.score));
  const leader = ordered[0];
  const runnerUp = ordered[1];
  const lead = leader && runnerUp ? Number(leader.score) - Number(runnerUp.score) : 0;

  return (
    <section className="scoreboard-experience section-wrap" data-refresh="scoreboard">
      <header className="leaderboard-header reveal visible">
        <div><p className="overline">Official live results</p><h1><span>Festival</span><br /><em>Scoreboard.</em></h1></div>
        <div className="leaderboard-status"><span><i /> {settings.scoreboard_live === false ? 'Final results' : 'Live scoring'}</span><p>Verified marks from the judging panel, updated as every result is confirmed.</p></div>
      </header>

      <div className="leaderboard-glass reveal visible">
        {leader ? <aside className="leader-feature" style={{ '--team': leader.color }}>
          <div className="leader-feature-top"><span className="leader-rank"><b>01</b><small>Top position</small></span><span className="leader-live"><i /> Current leader</span></div>
          <div className="leader-identity"><span className="leader-avatar"><b>{String(leader.name).charAt(0)}</b></span><div className="leader-identity-copy"><p>Team championship</p><h2>{leader.name}</h2><span>Leading the official festival standings</span></div></div>
          <div className="leader-performance"><div className="leader-score-block"><strong>{Math.round(Number(leader.score))}</strong><span>Verified points</span></div><div className="leader-advantage"><span>Lead advantage</span><strong>{lead > 0 ? `+${Math.round(lead)}` : 'Level'}</strong></div></div>
          <ScoreBar score={leader.score} className="leader-score-bar" />
        </aside> : null}

        <section className="ranking-panel" aria-label="Complete team standings">
          <header><div><span>Rank</span><strong>Team standings</strong></div><span>Points</span></header>
          <div className="ranking-list">
            {ordered.map((team, index) => {
              const score = Number(team.score);
              return <article key={team.id || team.slug} className={`ranking-row ${index === 0 ? 'is-leading' : ''}`} style={{ '--team': team.color, '--delay': `${index * 90}ms` }}>
                <span className="ranking-position">{String(index + 1).padStart(2,'0')}</span>
                <span className="team-signal" aria-hidden="true"><i /></span>
                <div className="ranking-team">
                  <div><h3>{team.name}</h3></div>
                  <ScoreBar score={score} className="ranking-score-bar" />
                </div>
                <strong className="ranking-score">{Math.round(score)}<small>pts</small></strong>
              </article>;
            })}
          </div>
          <footer><span><i>✓</i> Results verified</span><span>Updated <time>{updated}</time></span></footer>
        </section>
      </div>
    </section>
  );
}

function MusabaqaPlan() {
  const groups = ['Off stage', 'On stage'];
  return (
    <section className="musabaqa-plan section-wrap" aria-labelledby="musabaqa-plan-title">
      <header className="musabaqa-plan-hero reveal visible">
        <div>
          <p className="overline">Official programme · 2026–27</p>
          <h1 id="musabaqa-plan-title">Musabaqa<br /><em>programme plan.</em></h1>
          <p>Programme responsibilities and the working committee for the 2026–27 Kauzariyya Musabaqa.</p>
        </div>
        <div className="musabaqa-plan-stats" aria-label="Programme summary">
          <span><strong>15</strong><small>Programmes</small></span>
          <span><strong>08</strong><small>Committee roles</small></span>
        </div>
      </header>

      <div className="musabaqa-program-grid">
        {groups.map((group, groupIndex) => {
          const programs = musabaqaPrograms.filter(item => item.group === group);
          return <section key={group} className="musabaqa-program-section reveal visible">
            <header><div><p className="overline">Chapter 0{groupIndex + 1}</p><h2>{group}</h2></div><span>{String(programs.length).padStart(2,'0')} programmes</span></header>
            <div className="musabaqa-program-list">
              {programs.map(item => <article key={item.number} className={item.responsibility === 'To be assigned' ? 'is-pending' : ''}>
                <b>{String(item.number).padStart(2,'0')}</b>
                <div><h3>{item.program}</h3><p>{item.responsibility}</p></div>
                <span aria-hidden="true">{groupIndex === 0 ? '✎' : '●'}</span>
              </article>)}
            </div>
          </section>;
        })}
      </div>

      <section className="musabaqa-committee reveal visible" aria-labelledby="committee-title">
        <header><div><p className="overline">Festival leadership</p><h2 id="committee-title">Working committee</h2></div><p>The team coordinating programmes, stage operations, documentation, evaluation and awards.</p></header>
        <div>
          {musabaqaCommittee.map((item, index) => <article key={item.role}>
            <span>{String(index + 1).padStart(2,'0')}</span>
            <h3>{item.role}</h3>
            <p>{item.members}</p>
          </article>)}
        </div>
      </section>

      <p className="musabaqa-source-note"><span>✓</span> Prepared from the official MK26–27 programme sheet.</p>
    </section>
  );
}

function Review({ enabled = true }) {
  const [rating, setRating] = useState(0);
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [name, setName] = useState(() => window.localStorage.getItem('kauzariyya-visitor') || '');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const submit = async event => {
    event.preventDefault();
    if (!rating) { setError('Please select a star rating.'); return; }
    if (!name.trim() || !message.trim()) { setError('Please enter your name and review.'); return; }
    setSubmitting(true);
    setError('');
    try {
      await submitReview({ name: name.trim(), rating, message: message.trim() });
      setSent(true);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <section className="review-shell section-wrap">
      <div className="review-copy reveal visible">
        <p className="overline">Your voice matters</p>
        <h1>How was your<br /><em>experience?</em></h1>
        <p>Share what you enjoyed and what we can do better. Your opinion helps shape the next Kauzariyya Arts Festival.</p>
      </div>
      <form className="review-card reveal visible" onSubmit={submit}>
        {!enabled ? <div className="review-thanks"><span>—</span><h2>Reviews are paused.</h2><p>The administrator has temporarily closed new review submissions.</p></div> : sent ? <div className="review-thanks"><span>✓</span><h2>Review saved.</h2><p>Thank you. Your feedback has been securely added to our records.</p><button type="button" className="button button-ghost" onClick={() => { setSent(false); setRating(0); setMessage(''); }}>Write another review</button></div> : <>
          <div><span className="field-label">Overall rating</span><div className="rating-buttons" role="group" aria-label="Overall rating">{[1,2,3,4,5].map(value => <button key={value} type="button" className={rating >= value ? 'active' : ''} onClick={() => setRating(value)} aria-label={`${value} star${value > 1 ? 's' : ''}`}>★</button>)}</div></div>
          <label><span className="field-label">What did you think?</span><textarea required maxLength="2000" rows="5" value={message} onChange={event => setMessage(event.target.value)} placeholder="Tell us about your festival experience…" /></label>
          <label><span className="field-label">Your name</span><input required maxLength="100" type="text" value={name} onChange={event => setName(event.target.value)} placeholder="Name" /></label>
          {error ? <span className="review-error">{error}</span> : null}
          <button className="button button-review-submit" type="submit" disabled={submitting}>{submitting ? 'Saving review…' : 'Submit my review'}</button>
        </>}
      </form>
    </section>
  );
}

function PublicSectionUnavailable({ title, copy }) {
  return <section className="public-section-unavailable section-wrap"><span>Administrative notice</span><h1>{title}</h1><p>{copy}</p><a className="button button-light" href="/">Return to homepage</a></section>;
}

function SiteAnnouncement({ settings }) {
  if (!settings.announcement_enabled || !settings.announcement_text) return null;
  return <aside className="site-announcement" role="status"><i>!</i><strong>{settings.announcement_text}</strong>{settings.venue_name ? <span>{settings.venue_name}</span> : null}</aside>;
}

function Schedule({ items, blocks }) {
  const scheduleGroups = getScheduleGroups(blocks);
  const [active, setActive] = useState('subahi');
  return (
    <>
      <section className="schedule-head section-wrap reveal visible">
        <div><p className="overline">One day · One stage</p><h1>Full program<br /><em>schedule.</em></h1></div>
        <p>All program times in one place. Please arrive at the reporting desk at least 15 minutes before your program begins.</p>
      </section>
      <div className="schedule-tabs" role="tablist">
        {scheduleGroups.map(group => <button key={group.key} type="button" className={active === group.key ? 'active' : ''} onClick={() => setActive(group.key)}>{group.label}</button>)}
      </div>
      <section className="schedule-grid section-wrap">
        {scheduleGroups.map((group, groupIndex) => {
          const session = items.filter(item => item.session === group.key).sort((a, b) => a.start_time.localeCompare(b.start_time));
          return (
            <article key={group.key} className={`schedule-column reveal visible ${active === group.key ? 'mobile-active' : ''}`} data-session-column={group.key}>
              <header><span>0{groupIndex + 1}</span><h2>{group.label}</h2><small>{group.range}</small></header>
              {session.map(item => (
                <div key={item.id} className={`schedule-row ${item.status === 'live' ? 'live' : ''}`}>
                  <time>{item.start_time}</time>
                  <div><h3>{item.title}</h3><p>{item.category}</p></div>
                  <small>{item.duration_minutes} min</small>
                </div>
              ))}
              {!session.length ? <div className="schedule-empty">Programs can be added from the admin dashboard.</div> : null}
            </article>
          );
        })}
      </section>
    </>
  );
}

function Admin({ data }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [authenticated, setAuthenticated] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [tab, setTab] = useState('overview');
  const [adminTeams, setAdminTeams] = useState(data.teams);
  const [programs, setPrograms] = useState(data.schedule);
  const [editing, setEditing] = useState(null);
  const [schedulePopup, setSchedulePopup] = useState(null);
  const [timePopup, setTimePopup] = useState(null);
  const [participantEditing, setParticipantEditing] = useState(null);
  const [adminParticipants, setAdminParticipants] = useState(data.participants);
  const [adminProgramFilter, setAdminProgramFilter] = useState('all');
  const [notice, setNotice] = useState(null);
  const [adminLoading, setAdminLoading] = useState(null);
  const [settings, setSettings] = useState(data.settings || {});
  const [reviews, setReviews] = useState([]);
  const [visitorLogs, setVisitorLogs] = useState([]);
  const [participantQuery, setParticipantQuery] = useState('');
  const [collegeStudents, setCollegeStudents] = useState([]);
  const [collegeStudentEditing, setCollegeStudentEditing] = useState(null);
  const [collegeStudentQuery, setCollegeStudentQuery] = useState('');
  const [collegeStudentStatus, setCollegeStudentStatus] = useState('all');
  const [collegeStudentClass, setCollegeStudentClass] = useState('all');
  const studentListRef = useRef(null);

  useEffect(() => { setAdminTeams(data.teams); }, [data.teams]);
  useEffect(() => { setPrograms(data.schedule); }, [data.schedule]);
  useEffect(() => { setAdminParticipants(data.participants); }, [data.participants]);
  useEffect(() => { setSettings(data.settings || {}); }, [data.settings]);
  useEffect(() => {
    const startLoading = event => setAdminLoading(event.detail);
    const stopLoading = event => setAdminLoading(current => current?.requestId === event.detail.requestId ? null : current);
    window.addEventListener('admin-request-start', startLoading);
    window.addEventListener('admin-request-end', stopLoading);
    return () => {
      window.removeEventListener('admin-request-start', startLoading);
      window.removeEventListener('admin-request-end', stopLoading);
    };
  }, []);
  useEffect(() => {
    let active = true;
    fetch(apiEndpoint('admin-session'), { credentials:'same-origin', headers:{ Accept:'application/json' } })
      .then(response => response.json()).then(result => { if (active) setAuthenticated(Boolean(result.data?.authenticated)); })
      .catch(() => {}).finally(() => { if (active) setCheckingSession(false); });
    const expire = () => { setAuthenticated(false); setPassword(''); setError('Your session expired. Please sign in again.'); };
    window.addEventListener('admin-session-expired', expire);
    return () => { active = false; window.removeEventListener('admin-session-expired', expire); };
  }, []);
  useEffect(() => {
    if (!authenticated) return;
    Promise.all([
      adminRequest('reviews', 'GET'), adminRequest('students', 'GET'), adminRequest('visitor-logs', 'GET'),
      getResource('scoreboard'), getResource('schedule'), getResource('participants'), getResource('settings'),
    ])
      .then(([loadedReviews, loadedStudents, loadedVisitorLogs, loadedTeams, loadedPrograms, loadedParticipants, loadedSettings]) => {
        setReviews(loadedReviews); setCollegeStudents(loadedStudents); setVisitorLogs(loadedVisitorLogs); setAdminTeams(loadedTeams);
        setPrograms(loadedPrograms); setAdminParticipants(loadedParticipants); setSettings(loadedSettings);
      })
      .catch(err => flash(err.message, 'error'));
  }, [authenticated]);
  const scheduleGroups = getScheduleGroups(settings.schedule_blocks);
  const scheduleGroupByKey = Object.fromEntries(scheduleGroups.map(group => [group.key, group]));
  const filteredAdminParticipants = adminParticipants.filter(person => {
    const inProgram = adminProgramFilter === 'all' || Number(person.program_id) === Number(adminProgramFilter);
    const needle = participantQuery.trim().toLowerCase();
    return inProgram && (!needle || `${person.name} ${person.code} ${person.team_name || ''} ${person.program || ''}`.toLowerCase().includes(needle));
  });
  const collegeStudentClasses = [...new Set(collegeStudents.map(student => student.class_id).filter(Boolean).map(Number))].sort((a,b) => a-b);
  const nextCollegeChessNumber = `KZ-${String(Math.max(0, ...collegeStudents.map(student => Number(String(student.chess_number || '').match(/\d+/)?.[0] || 0))) + 1).padStart(3, '0')}`;
  const filteredCollegeStudents = collegeStudents.filter(student => {
    const needle = collegeStudentQuery.trim().toLowerCase();
    const matchesQuery = !needle || `${student.full_name || ''} ${student.display_name || ''} ${student.name_arabic || ''} ${student.chess_number || ''} ${student.place || ''} ${student.admission_no || ''} ${student.phone || ''}`.toLowerCase().includes(needle);
    const matchesStatus = collegeStudentStatus === 'all' || student.status === collegeStudentStatus;
    const matchesClass = collegeStudentClass === 'all' || Number(student.class_id) === Number(collegeStudentClass);
    return matchesQuery && matchesStatus && matchesClass;
  });
  useEffect(() => {
    if (!schedulePopup) return undefined;
    const closeOnEscape = event => { if (event.key === 'Escape') setSchedulePopup(null); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [schedulePopup]);

  const flash = (message, type = 'success') => { setNotice({ message, type }); window.setTimeout(() => setNotice(null), 3200); };
  const saveScore = async (team, score) => {
    try {
      const updated = await adminRequest('scores', 'PATCH', { team_id: team.id, score: Number(score) });
      setAdminTeams(items => items.map(item => item.id === team.id ? { ...item, ...updated } : item));
      flash(`${team.name} score updated`);
    } catch (err) { flash(err.message, 'error'); }
  };
  const saveProgram = async values => {
    try {
      const updated = await adminRequest('programs', editing ? 'PATCH' : 'POST', editing ? { ...values, id: editing.id } : values);
      setPrograms(items => editing ? items.map(item => item.id === editing.id ? updated : item) : [...items, updated]);
      setEditing(null); flash(editing ? 'Program updated' : 'Program added');
    } catch (err) { flash(err.message, 'error'); }
  };
  const saveScheduleTime = async values => {
    try {
      const blocks = await adminRequest('schedule-blocks', 'PATCH', values);
      setSettings(current => ({ ...current, schedule_blocks:blocks }));
      setTimePopup(null);
      flash(`${scheduleGroupByKey[values.key]?.label || 'Schedule'} time updated`);
    } catch (err) { flash(err.message, 'error'); }
  };
  const deleteProgram = async program => {
    if (!window.confirm(`Delete “${program.title}”? This cannot be undone.`)) return;
    try { await adminRequest('programs', 'DELETE', { id: program.id }); setPrograms(items => items.filter(item => item.id !== program.id)); flash('Program deleted'); }
    catch (err) { flash(err.message, 'error'); }
  };
  const saveParticipant = async values => {
    try {
      const updated = await adminRequest('participants', participantEditing ? 'PATCH' : 'POST', participantEditing ? { ...values, id: participantEditing.id } : values);
      setAdminParticipants(items => participantEditing ? items.map(item => item.id === participantEditing.id ? { ...item, ...updated } : item) : [...items, updated]);
      setParticipantEditing(null); flash(participantEditing ? 'Participant updated' : 'Participant published');
      return true;
    } catch (err) { flash(err.message, 'error'); return false; }
  };
  const deleteParticipant = async participant => {
    if (!window.confirm(`Delete “${participant.name}”? This cannot be undone.`)) return;
    try { await adminRequest('participants', 'DELETE', { id: participant.id }); setAdminParticipants(items => items.filter(item => item.id !== participant.id)); flash('Student deleted'); }
    catch (err) { flash(err.message, 'error'); }
  };
  const saveCollegeStudent = async values => {
    try {
      const updated = await adminRequest('students', collegeStudentEditing ? 'PATCH' : 'POST', collegeStudentEditing ? { ...values, id:collegeStudentEditing.id } : values);
      setCollegeStudents(items => collegeStudentEditing ? items.map(item => Number(item.id) === Number(collegeStudentEditing.id) ? updated : item) : [...items, updated]);
      setCollegeStudentEditing(null);
      flash(collegeStudentEditing ? 'Student record updated' : 'Student added to college roster');
      return true;
    } catch (err) { flash(err.message, 'error'); return false; }
  };
  const deleteCollegeStudent = async student => {
    if (!window.confirm(`Delete ${student.full_name} from the college roster?`)) return;
    try {
      await adminRequest('students', 'DELETE', { id:student.id });
      setCollegeStudents(items => items.filter(item => Number(item.id) !== Number(student.id)));
      setCollegeStudentEditing(current => Number(current?.id) === Number(student.id) ? null : current);
      flash('Student removed from college roster');
    } catch (err) { flash(err.message, 'error'); }
  };
  const saveSettings = async values => {
    try {
      const updated = await adminRequest('settings', 'PATCH', values);
      setSettings(updated);
      flash('Website settings saved');
    } catch (err) { flash(err.message, 'error'); }
  };
  const saveTeam = async values => {
    try {
      const updated = await adminRequest('teams', 'PATCH', values);
      setAdminTeams(items => items.map(item => Number(item.id) === Number(updated.id) ? { ...item, ...updated } : item));
      flash('Team identity updated');
      return true;
    } catch (err) { flash(err.message, 'error'); return false; }
  };
  const saveTeamImage = async (team, file) => {
    try {
      const updated = await uploadTeamImage(team.id, file);
      setAdminTeams(items => items.map(item => Number(item.id) === Number(team.id) ? { ...item, profile_image:updated.profile_image } : item));
      flash(`${team.name} image uploaded`);
      return true;
    } catch (err) { flash(err.message, 'error'); return false; }
  };
  const deleteReview = async review => {
    if (!window.confirm(`Delete the review from ${review.name}?`)) return;
    try { await adminRequest('reviews', 'DELETE', { id:review.id }); setReviews(items => items.filter(item => item.id !== review.id)); flash('Review deleted'); }
    catch (err) { flash(err.message, 'error'); }
  };
  const logout = async () => {
    try { await fetch(apiEndpoint('admin-session'), { method:'DELETE', credentials:'same-origin', headers:{ Accept:'application/json' } }); } catch {}
    setAuthenticated(false); setPassword(''); setTab('overview');
  };

  const submitLogin = async event => {
    event.preventDefault();
    setError('');
    try {
      const response = await fetch(apiEndpoint('admin-login'), { method:'POST', credentials:'same-origin', headers:{ Accept:'application/json', 'Content-Type':'application/json' }, body:JSON.stringify({ password }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Unable to sign in');
      setAuthenticated(true);
    } catch (err) { setError(err.message); }
  };

  if (checkingSession) return <section className="admin-login-shell section-wrap"><div className="admin-login-card admin-session-check"><span className="admin-saving-spinner" aria-hidden="true"><i /><i /><i /></span><p>Checking secure session…</p></div></section>;

  if (!authenticated) {
    return (
      <section className="admin-login-shell section-wrap">
        <div className="admin-login-card reveal visible">
          <img src="assets/thanafus-logo.png" alt="Thanafus" />
          <p className="overline">Admin router</p>
          <h1>Secure dashboard access.</h1>
          <p>Enter the administrator passcode to open institutional controls, live scores and database setup guidance.</p>
          <form className="admin-login-form" onSubmit={submitLogin}>
            <label htmlFor="admin-pass">Password</label>
            <input id="admin-pass" type="password" inputMode="numeric" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} placeholder="Enter admin password" />
            {error ? <span className="login-error">{error}</span> : null}
            <button className="button button-light" type="submit">Unlock dashboard</button>
          </form>
        </div>
      </section>
    );
  }

  return (
    <section className="admin-dashboard admin-control-shell section-wrap">
      {adminLoading ? <div className="admin-saving-overlay" role="status" aria-live="assertive" aria-label={adminLoading.message}>
        <div className="admin-saving-dialog">
          <span className="admin-saving-spinner" aria-hidden="true"><i /><i /><i /></span>
          <div><strong>{adminLoading.message}</strong><small>Please wait—your changes are being uploaded.</small></div>
          <b aria-hidden="true" />
        </div>
      </div> : null}
      <aside className="admin-sidebar">
        <div className="admin-side-brand"><img src="assets/kauzariyya-brand-icon.png" alt="" /><span><strong>Kauzariyya</strong><small>Festival control</small></span></div>
        <nav aria-label="Admin sections">
          <button className={tab === 'overview' ? 'active' : ''} type="button" onClick={() => setTab('overview')}><b>⌂</b><span>Overview</span></button>
          <button className={tab === 'scores' ? 'active' : ''} type="button" onClick={() => setTab('scores')}><b>↗</b><span>Scores</span></button>
          <button className={tab === 'teams' ? 'active' : ''} type="button" onClick={() => setTab('teams')}><b>◫</b><span>Teams</span><small>{adminTeams.length}</small></button>
          <button className={tab === 'programs' ? 'active' : ''} type="button" onClick={() => setTab('programs')}><b>▤</b><span>Programs</span><small>{programs.length}</small></button>
          <button className={tab === 'participants' ? 'active' : ''} type="button" onClick={() => setTab('participants')}><b>◎</b><span>Participants</span><small>{adminParticipants.length}</small></button>
          <button className={tab === 'students' ? 'active' : ''} type="button" onClick={() => setTab('students')}><b>♙</b><span>Students</span><small>{collegeStudents.length}</small></button>
          <button className={tab === 'reviews' ? 'active' : ''} type="button" onClick={() => setTab('reviews')}><b>☆</b><span>Reviews</span><small>{reviews.length}</small></button>
          <button className={tab === 'visitor-logs' ? 'active' : ''} type="button" onClick={() => setTab('visitor-logs')}><b>◎</b><span>Visitor Logs</span><small>{visitorLogs.length}</small></button>
          <button className={tab === 'settings' ? 'active' : ''} type="button" onClick={() => setTab('settings')}><b>⚙</b><span>Settings</span></button>
        </nav>
        <div className="admin-identity"><span>AD</span><div><strong>Super Admin</strong><small>Administrator</small></div></div>
        <a href="/" className="admin-home-link">← Back to website</a>
      </aside>
      <div className="admin-workspace">
        <header className="admin-workspace-head reveal visible"><div><p className="overline"><i className="admin-online-dot" /> Secure control center</p><h1>{tab === 'overview' ? 'Dashboard overview' : tab === 'scores' ? 'Score management' : tab === 'teams' ? 'Team management' : tab === 'programs' ? 'Program management' : tab === 'participants' ? 'Participant management' : tab === 'students' ? 'College student records' : tab === 'reviews' ? 'Review inbox' : tab === 'visitor-logs' ? 'Visitor Logs' : 'Website settings'}</h1><p>Manage the live Kauzariyya Arts Festival from one secure workspace.</p></div><div className="admin-head-actions"><a className="admin-preview-link" href="/">View site ↗</a><button className="button button-ghost" type="button" onClick={logout}>Lock</button></div></header>
        {notice ? <div className={`admin-toast ${notice.type}`}>{notice.message}</div> : null}
      {tab === 'overview' ? <section className="admin-overview">
        <div className="active-event-card"><div><span>Active festival</span><h2>{settings.festival_name || 'Kauzariyya Arts Festival 2026'}</h2><p>Live database connected · public results enabled</p></div><i><b>{settings.scoreboard_live === false ? 'FINAL' : 'LIVE'}</b></i></div>
        <div className="overview-metrics">
          <OverviewMetric tone="green" icon="◈" value={adminTeams.length} label="Teams" detail="Competing live" />
          <OverviewMetric tone="cyan" icon="◎" value={collegeStudents.length} label="Students" detail="College roster" />
          <OverviewMetric tone="gold" icon="▤" value={programs.length} label="Programs" detail="Across all sessions" />
          <OverviewMetric tone="violet" icon="☆" value={reviews.length} label="Reviews" detail="Visitor feedback received" />
        </div>
        <div className="overview-bento">
          <section className="admin-live-standings"><header><div><p className="overline">Score pulse</p><h2>Live standings</h2></div><button type="button" onClick={() => setTab('scores')}>Manage →</button></header><div>{[...adminTeams].sort((a,b)=>Number(b.score)-Number(a.score)).map((team,index)=><article key={team.id} style={{'--team':team.color}}><b>{String(index+1).padStart(2,'0')}</b><i /><div className="admin-standing-team"><span>{team.name}</span><ScorePercentage score={team.score} /></div><strong>{Math.round(Number(team.score))}</strong></article>)}</div></section>
          <section className="admin-program-pulse"><header><div><p className="overline">Program desk</p><h2>Up next</h2></div><button type="button" onClick={() => setTab('programs')}>View all →</button></header><div>{[...programs].filter(item=>item.status!=='completed').sort((a,b)=>a.start_time.localeCompare(b.start_time)).slice(0,4).map(item=><article key={item.id}><time>{item.start_time}</time><span><strong>{item.title}</strong><small>{item.venue}</small></span><i className={item.status}>{item.status}</i></article>)}</div></section>
        </div>
        <div className="quick-actions"><div><p className="overline">Common tasks</p><h2>Quick actions</h2></div><div><button type="button" onClick={() => setTab('scores')}>Update scores <span>→</span></button><button type="button" onClick={() => setTab('programs')}>Add a program <span>→</span></button><button type="button" onClick={() => setTab('participants')}>Add a participant <span>→</span></button><button type="button" onClick={() => setTab('students')}>Manage students <span>→</span></button><button type="button" onClick={() => setTab('settings')}>Website settings <span>→</span></button><a href="/scoreboard">Open public board <span>↗</span></a></div></div>
      </section> : tab === 'scores' ? <section className="score-editor-grid">
        {adminTeams.map((team, index) => <ScoreEditor key={team.id} team={team} rank={index + 1} onSave={saveScore} />)}
      </section> : tab === 'teams' ? <TeamManager teams={adminTeams} participants={adminParticipants} onSave={saveTeam} onUpload={saveTeamImage} />
      : tab === 'programs' ? <section className="program-manager">
        <ProgramForm program={editing} scheduleGroups={scheduleGroups} onSave={saveProgram} onCancel={() => setEditing(null)} />
        <div className="program-admin-list">
          <div className="program-list-head"><div><p className="overline">Schedule records</p><h2>All programs</h2></div><span>{programs.length} total</span></div>
          <div className="admin-schedule-groups">
            {scheduleGroups.map((group, groupIndex) => {
              const groupPrograms = programs.filter(program => program.session === group.key).sort((a,b) => a.start_time.localeCompare(b.start_time));
              return <section key={group.key} className="admin-schedule-group">
                <header className="admin-schedule-group-head">
                  <span>0{groupIndex + 1}</span>
                  <div><h3>{group.label}</h3><small>{group.range}</small></div>
                  <div className="admin-schedule-group-actions">
                    <b>{groupPrograms.length} {groupPrograms.length === 1 ? 'program' : 'programs'}</b>
                    <button type="button" onClick={() => setTimePopup(group.key)}>Edit time</button>
                    <button type="button" onClick={() => setSchedulePopup(group.key)}>View programs</button>
                  </div>
                </header>
              </section>;
            })}
          </div>
        </div>
        {schedulePopup ? (() => {
          const group = scheduleGroupByKey[schedulePopup];
          const groupPrograms = programs.filter(program => program.session === schedulePopup).sort((a,b) => a.start_time.localeCompare(b.start_time));
          return <div className="admin-program-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setSchedulePopup(null); }}>
            <section className="admin-program-modal" role="dialog" aria-modal="true" aria-labelledby="admin-program-modal-title">
              <header>
                <div><p className="overline">Schedule block</p><h2 id="admin-program-modal-title">{group.label} programs</h2><small>{group.range} · {groupPrograms.length} {groupPrograms.length === 1 ? 'program' : 'programs'}</small></div>
                <button type="button" autoFocus aria-label="Close program list" onClick={() => setSchedulePopup(null)}>×</button>
              </header>
              <div className="admin-program-modal-list">
                {groupPrograms.map(program => <article key={program.id} className="program-admin-row">
                  <time>{program.start_time}</time><div><h3>{program.title}</h3><p>{program.category} · {program.venue}</p></div>
                  <span className={`status-pill ${program.status}`}>{program.status}</span>
                  <div className="row-actions"><button type="button" onClick={() => { setEditing(program); setSchedulePopup(null); }}>Edit</button><button className="danger" type="button" onClick={() => deleteProgram(program)}>Delete</button></div>
                </article>)}
                {!groupPrograms.length ? <div className="admin-modal-empty"><p>No programs added to this schedule block.</p><button className="button button-light" type="button" onClick={() => { setEditing(null); setSchedulePopup(null); }}>Add a program</button></div> : null}
              </div>
            </section>
          </div>;
        })() : null}
        {timePopup ? <ScheduleTimeModal group={scheduleGroupByKey[timePopup]} onSave={saveScheduleTime} onClose={() => setTimePopup(null)} /> : null}
      </section> : tab === 'participants' ? <section className="program-manager student-manager">
        <ParticipantForm participant={participantEditing} teams={adminTeams} programs={programs} defaultProgramId={adminProgramFilter === 'all' ? '' : adminProgramFilter} onSave={saveParticipant} onCancel={() => setParticipantEditing(null)} />
        <div className="program-admin-list student-records-panel">
          <div className="program-list-head admin-roster-head"><div><p className="overline">Program roster</p><h2>{adminProgramFilter === 'all' ? 'All participants' : programs.find(program => Number(program.id) === Number(adminProgramFilter))?.title || 'Participants'}</h2></div><span>{filteredAdminParticipants.length} students</span></div>
          <div className="admin-roster-tools"><label className="admin-roster-filter"><span>Filter by program</span><select value={adminProgramFilter} onChange={event => { setAdminProgramFilter(event.target.value); setParticipantEditing(null); studentListRef.current?.scrollTo({ top:0, behavior:'smooth' }); }}><option value="all">All programs</option>{programs.map(program => <option key={program.id} value={program.id}>{program.title}</option>)}</select></label><label className="admin-search-field"><span>Search roster</span><input type="search" value={participantQuery} onChange={event => setParticipantQuery(event.target.value)} placeholder="Name, chess no. or team" /></label></div>
          <div className="student-records-scroll" ref={studentListRef}>
            {filteredAdminParticipants.map(person => <article key={person.id} className="program-admin-row student-admin-row">
              <b>{person.code}</b><div><h3>{person.name}</h3><p>{person.team_name || adminTeams.find(team => Number(team.id) === Number(person.team_id))?.name || 'Team'} · {person.program || programs.find(program => Number(program.id) === Number(person.program_id))?.title || 'Program'}</p></div>
              <time>{person.reporting_time}</time>
              <div className="row-actions"><button type="button" onClick={() => setParticipantEditing(person)}>Edit</button><button className="danger" type="button" onClick={() => deleteParticipant(person)}>Delete</button></div>
            </article>)}
            {!filteredAdminParticipants.length ? <p className="admin-roster-empty">No students have been added to this program yet.</p> : null}
          </div>
          <button className="student-list-scroll-button" type="button" aria-label="Scroll through more students" onClick={() => {
            const list = studentListRef.current;
            if (!list) return;
            const atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 8;
            list.scrollTo({ top: atBottom ? 0 : list.scrollTop + list.clientHeight * .75, behavior:'smooth' });
          }}>↓</button>
        </div>
      </section> : tab === 'students' ? <CollegeStudentManager students={filteredCollegeStudents} total={collegeStudents.length} nextChessNumber={nextCollegeChessNumber} editing={collegeStudentEditing} onEdit={setCollegeStudentEditing} onSave={saveCollegeStudent} onDelete={deleteCollegeStudent} query={collegeStudentQuery} onQuery={setCollegeStudentQuery} status={collegeStudentStatus} onStatus={setCollegeStudentStatus} classFilter={collegeStudentClass} onClassFilter={setCollegeStudentClass} classes={collegeStudentClasses} />
      : tab === 'reviews' ? <ReviewsPanel reviews={reviews} onDelete={deleteReview} /> : tab === 'visitor-logs' ? <VisitorLogsPanel logs={visitorLogs} /> : <SettingsPanel settings={settings} onSave={saveSettings} />}
      </div>
    </section>
  );
}

const emptyCollegeStudent = {
  source_id:'', full_name:'', display_name:'', name_arabic:'', place:'', admission_no:'', class_id:'', maddhab_id:'', phone:'', email:'', dob:'', guardian_name:'', guardian_phone:'', status:'active', chess_number:'',
};

function collegeClassLabel(classId) {
  if (Number(classId) === 10) return 'Hifz';
  return classId ? `Class ${classId}` : 'Class not set';
}

function CollegeStudentManager({ students, total, nextChessNumber, editing, onEdit, onSave, onDelete, query, onQuery, status, onStatus, classFilter, onClassFilter, classes }) {
  const [form, setForm] = useState({ ...emptyCollegeStudent, chess_number:nextChessNumber });
  useEffect(() => {
    setForm(editing ? { ...emptyCollegeStudent, ...editing, dob:editing.dob || '' } : { ...emptyCollegeStudent, chess_number:nextChessNumber });
  }, [editing, nextChessNumber]);
  const field = (name, value) => setForm(current => ({ ...current, [name]:value }));
  const submit = async event => {
    event.preventDefault();
    const saved = await onSave(form);
    if (saved && !editing) setForm({ ...emptyCollegeStudent, chess_number:nextChessNumber });
  };
  return <section className="college-student-manager">
    <form className="college-student-form" onSubmit={submit}>
      <header><div><p className="overline">College master roster</p><h2>{editing ? 'Edit student record' : 'Add a student'}</h2><small>Chess numbers are unique and can be changed at any time.</small></div>{editing ? <button type="button" onClick={() => onEdit(null)}>Cancel</button> : null}</header>
      <div className="college-student-form-grid">
        <label className="span-2"><span>Full name *</span><input required maxLength="200" value={form.full_name} onChange={event => field('full_name',event.target.value)} /></label>
        <label><span>Chess number *</span><input required maxLength="50" value={form.chess_number} onChange={event => field('chess_number',event.target.value.toUpperCase())} /></label>
        <label><span>Display name</span><input maxLength="150" value={form.display_name || ''} onChange={event => field('display_name',event.target.value)} /></label>
        <label dir="rtl"><span>Arabic name</span><input maxLength="200" value={form.name_arabic || ''} onChange={event => field('name_arabic',event.target.value)} /></label>
        <label><span>Place</span><input maxLength="100" value={form.place || ''} onChange={event => field('place',event.target.value)} /></label>
        <label><span>Admission number</span><input maxLength="50" value={form.admission_no || ''} onChange={event => field('admission_no',event.target.value)} /></label>
        <label><span>Class {Number(form.class_id) === 10 ? '· Hifz' : 'ID'}</span><input type="number" min="1" value={form.class_id || ''} onChange={event => field('class_id',event.target.value)} /></label>
        <label><span>Maddhab ID</span><input type="number" min="1" value={form.maddhab_id || ''} onChange={event => field('maddhab_id',event.target.value)} /></label>
        <label><span>Phone</span><input type="tel" maxLength="30" value={form.phone || ''} onChange={event => field('phone',event.target.value)} /></label>
        <label className="span-2"><span>Email</span><input type="email" maxLength="150" value={form.email || ''} onChange={event => field('email',event.target.value)} /></label>
        <label><span>Date of birth</span><input type="date" value={form.dob || ''} onChange={event => field('dob',event.target.value)} /></label>
        <label><span>Guardian name</span><input maxLength="200" value={form.guardian_name || ''} onChange={event => field('guardian_name',event.target.value)} /></label>
        <label><span>Guardian phone</span><input type="tel" maxLength="30" value={form.guardian_phone || ''} onChange={event => field('guardian_phone',event.target.value)} /></label>
        <label><span>Status</span><select value={form.status || 'active'} onChange={event => field('status',event.target.value)}><option value="active">Active</option><option value="graduated">Graduated</option><option value="left">Left</option><option value="inactive">Inactive</option></select></label>
      </div>
      <button className="button button-light" type="submit">{editing ? 'Save student changes' : 'Add student to roster'}</button>
    </form>
    <div className="college-student-directory">
      <header><div><p className="overline">Imported student data</p><h2>All college students</h2></div><strong>{students.length}<small>of {total}</small></strong></header>
      <div className="college-student-filters">
        <label className="student-directory-search"><span>Search</span><input type="search" value={query} onChange={event => onQuery(event.target.value)} placeholder="Name, chess no., place or phone" /></label>
        <label><span>Status</span><select value={status} onChange={event => onStatus(event.target.value)}><option value="all">All statuses</option><option value="active">Active</option><option value="graduated">Graduated</option><option value="left">Left</option><option value="inactive">Inactive</option></select></label>
        <label><span>Class</span><select value={classFilter} onChange={event => onClassFilter(event.target.value)}><option value="all">All classes</option>{classes.map(classId => <option key={classId} value={classId}>{collegeClassLabel(classId)}</option>)}</select></label>
      </div>
      <div className="college-student-list">
        {students.map(student => <article key={student.id} className={editing?.id === student.id ? 'editing' : ''}>
          <b>{student.chess_number}</b>
          <div className="college-student-name"><h3>{student.display_name || student.full_name}</h3><p>{student.full_name}{student.name_arabic ? <span lang="ar" dir="rtl"> · {student.name_arabic}</span> : null}</p></div>
          <div className="college-student-meta"><span>{collegeClassLabel(student.class_id)}</span><span>{student.place || 'Place not set'}</span><i className={student.status}>{student.status}</i></div>
          <div className="row-actions"><button type="button" onClick={() => { onEdit(student); window.scrollTo({ top:120, behavior:'smooth' }); }}>Edit</button><button className="danger" type="button" onClick={() => onDelete(student)}>Delete</button></div>
        </article>)}
        {!students.length ? <div className="admin-empty-state"><span>⌕</span><h3>No matching students</h3><p>Change the search or filters to view other records.</p></div> : null}
      </div>
    </div>
  </section>;
}

function SettingsPanel({ settings, onSave }) {
  const defaults = { festival_name:'Kauzariyya Arts Festival 2026', festival_date:'2026-07-05', intro_video_enabled:true, intro_video_url:'assets/intro.mp4', intro_video_loop:false, video_darkness:38, animations_enabled:true, scoreboard_live:true, announcement_enabled:false, announcement_text:'Welcome to the Kauzariyya Arts Festival.', schedule_visible:true, participants_visible:true, reviews_enabled:true, venue_name:'Al Jamiathul Kauzariyya Campus', contact_email:'' };
  const [form, setForm] = useState({ ...defaults, ...settings });
  const [saving, setSaving] = useState(false);
  useEffect(() => setForm({ ...defaults, ...settings }), [settings]);
  const field = (name, value) => setForm(current => ({ ...current, [name]:value }));
  const submit = async event => { event.preventDefault(); setSaving(true); await onSave(form); setSaving(false); };
  return <form className="settings-workspace" onSubmit={submit}>
    <section className="settings-card settings-identity-card">
      <header><span>01</span><div><p className="overline">Festival identity</p><h2>Public information</h2></div></header>
      <div className="settings-fields two-columns">
        <label><span>Festival name</span><input required maxLength="120" value={form.festival_name} onChange={e => field('festival_name',e.target.value)} /></label>
        <label><span>Festival date</span><input required type="date" value={form.festival_date} onChange={e => field('festival_date',e.target.value)} /></label>
      </div>
    </section>
    <section className="settings-card settings-video-card">
      <header><span>02</span><div><p className="overline">Homepage media</p><h2>Intro background video</h2></div><SettingSwitch checked={form.intro_video_enabled} onChange={value => field('intro_video_enabled',value)} label="Video enabled" /></header>
      <div className="video-setting-preview"><video muted playsInline preload="metadata" src={form.intro_video_url || 'assets/intro.mp4'} /><div style={{opacity:Number(form.video_darkness)/100}} /><span>{form.intro_video_enabled ? 'Video active' : 'Video hidden'}</span></div>
      <div className="settings-fields">
        <label><span>Video file or URL</span><input required maxLength="500" value={form.intro_video_url} onChange={e => field('intro_video_url',e.target.value)} placeholder="assets/intro.mp4" /><small>Use a project path such as assets/intro.mp4 or a direct MP4 URL.</small></label>
        <label><span>Background darkness <b>{form.video_darkness}%</b></span><input type="range" min="0" max="75" value={form.video_darkness} onChange={e => field('video_darkness',Number(e.target.value))} /></label>
      </div>
      <div className="settings-switch-grid"><SettingSwitch checked={form.intro_video_loop} onChange={value => field('intro_video_loop',value)} label="Loop continuously" copy={form.intro_video_loop ? 'Video restarts automatically.' : 'Video plays one time only.'} /><SettingSwitch checked={form.animations_enabled} onChange={value => field('animations_enabled',value)} label="Interface animations" copy="Controls public page transitions and motion." /></div>
    </section>
    <section className="settings-card settings-publishing-card">
      <header><span>03</span><div><p className="overline">Publishing</p><h2>Public result state</h2></div></header>
      <SettingSwitch checked={form.scoreboard_live} onChange={value => field('scoreboard_live',value)} label="Live scoring enabled" copy={form.scoreboard_live ? 'The public board displays a live status.' : 'The public board displays final results.'} />
      <div className="settings-visibility-list"><SettingSwitch checked={form.schedule_visible} onChange={value => field('schedule_visible',value)} label="Publish schedule" copy="Controls access to the public schedule." /><SettingSwitch checked={form.participants_visible} onChange={value => field('participants_visible',value)} label="Publish participant directory" copy="Controls access to participant records." /><SettingSwitch checked={form.reviews_enabled} onChange={value => field('reviews_enabled',value)} label="Accept visitor reviews" copy="Opens or closes the public review form." /></div>
    </section>
    <section className="settings-card settings-announcement-card">
      <header><span>04</span><div><p className="overline">Announcement</p><h2>Website notice</h2></div><SettingSwitch checked={form.announcement_enabled} onChange={value => field('announcement_enabled',value)} label="Show notice" /></header>
      <div className="settings-fields"><label><span>Announcement text</span><input maxLength="240" value={form.announcement_text} onChange={e => field('announcement_text',e.target.value)} placeholder="Important festival update…" /><small>This notice appears above every public page.</small></label></div>
    </section>
    <section className="settings-card settings-contact-card">
      <header><span>05</span><div><p className="overline">Contact details</p><h2>Venue and support</h2></div></header>
      <div className="settings-fields"><label><span>Venue name</span><input maxLength="140" value={form.venue_name} onChange={e => field('venue_name',e.target.value)} /></label><label><span>Contact email</span><input type="email" maxLength="160" value={form.contact_email} onChange={e => field('contact_email',e.target.value)} placeholder="festival@example.com" /></label></div>
    </section>
    <div className="settings-savebar"><div><strong>Ready to publish?</strong><span>Changes apply to the public website after saving.</span></div><button className="button button-light" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save website settings'}</button></div>
  </form>;
}

function SettingSwitch({ checked, onChange, label, copy }) { return <label className="setting-switch"><input type="checkbox" checked={Boolean(checked)} onChange={event => onChange(event.target.checked)} /><i><b /></i><span><strong>{label}</strong>{copy ? <small>{copy}</small> : null}</span></label>; }

function OverviewMetric({ icon, value, label, detail, tone }) { return <article className={`overview-metric tone-${tone}`}><span>{icon}</span><div><strong>{value}</strong><small>{label}</small></div><p>{detail}</p></article>; }

function TeamManager({ teams, participants, onSave, onUpload }) {
  return <section className="team-manager-grid">
    {teams.map(team => <TeamControlCard key={team.id} team={team} memberCount={participants.filter(person => Number(person.team_id) === Number(team.id) || person.team_name === team.name).length} onSave={onSave} onUpload={onUpload} />)}
  </section>;
}

function TeamControlCard({ team, memberCount, onSave, onUpload }) {
  const [form, setForm] = useState({ id:team.id, name:team.name, color:team.color });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  useEffect(() => setForm({ id:team.id, name:team.name, color:team.color }), [team.id, team.name, team.color]);
  const dirty = form.name.trim() !== team.name || form.color.toLowerCase() !== String(team.color).toLowerCase();
  const submit = async event => { event.preventDefault(); setSaving(true); await onSave(form); setSaving(false); };
  return <form className="team-control-card" style={{ '--team':form.color }} onSubmit={submit}>
    <header><span className={`team-control-swatch ${team.profile_image ? 'has-image' : ''}`}>{team.profile_image ? <img src={team.profile_image} alt="" /> : <i />}</span><div><p className="overline">Team profile</p><h2>{team.name}</h2></div><strong>{Math.round(Number(team.score))}<small>points</small></strong></header>
    <label className="team-image-upload"><span>Team profile image</span><input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading} onChange={async event => { const file=event.target.files?.[0]; if (!file) return; setUploading(true); await onUpload(team,file); setUploading(false); event.target.value=''; }} /><div><b>{uploading ? 'Uploading…' : team.profile_image ? 'Replace image' : 'Upload image'}</b><small>JPG, PNG or WebP · maximum 3 MB</small></div></label>
    <div className="team-control-stats"><span><b>{memberCount}</b> participants</span><span><b>{team.slug}</b> system key</span></div>
    <label><span>Display name</span><input required maxLength="80" value={form.name} onChange={event => setForm(current => ({ ...current, name:event.target.value }))} /></label>
    <label><span>Brand color</span><div className="team-color-field"><input type="color" value={form.color} onChange={event => setForm(current => ({ ...current, color:event.target.value }))} /><input required pattern="#[0-9a-fA-F]{6}" value={form.color} onChange={event => setForm(current => ({ ...current, color:event.target.value }))} /></div></label>
    <button className="button button-light" type="submit" disabled={!dirty || saving}>{saving ? 'Saving…' : dirty ? 'Save team profile' : 'Profile up to date'}</button>
  </form>;
}

function formatAdminDate(value) {
  if (!value) return 'Date unavailable';
  const normalized = String(value).replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00');
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : new Intl.DateTimeFormat('en-GB', { dateStyle:'medium', timeStyle:'short' }).format(date);
}

function ReviewsPanel({ reviews, onDelete }) {
  const average = reviews.length ? reviews.reduce((total, review) => total + Number(review.rating || 0), 0) / reviews.length : 0;
  return <section className="review-admin-workspace">
    <header className="review-admin-summary"><div><p className="overline">Feedback health</p><h2>{reviews.length ? `${average.toFixed(1)} average rating` : 'No reviews yet'}</h2><p>{reviews.length} verified website submission{reviews.length === 1 ? '' : 's'}</p></div><strong>{average ? average.toFixed(1) : '—'}<span>★★★★★</span></strong></header>
    <div className="review-admin-list">
      {reviews.map(review => <article key={review.id} className="review-admin-card">
        <header><span>{String(review.name || '?').trim().charAt(0).toUpperCase()}</span><div><h3>{review.name}</h3><time>{formatAdminDate(review.created_at)}</time></div><b aria-label={`${review.rating} out of 5 stars`}>{'★'.repeat(Number(review.rating) || 0)}<i>{'★'.repeat(Math.max(0, 5 - Number(review.rating || 0)))}</i></b></header>
        <p>{review.message}</p>
        <footer><span>Review #{review.id}</span><button className="danger" type="button" onClick={() => onDelete(review)}>Delete review</button></footer>
      </article>)}
      {!reviews.length ? <div className="admin-empty-state"><span>☆</span><h3>Your review inbox is clear</h3><p>New visitor feedback will appear here automatically.</p><a className="button button-ghost" href="/review">Open review page</a></div> : null}
    </div>
  </section>;
}

function VisitorLogsPanel({ logs }) {
  // Helper to get initials
  const getInitials = (name) => {
    if (!name) return '?';
    return name.substring(0, 2).toUpperCase();
  };

  return <section className="program-manager student-manager">
    <header className="panel-header"><div><h2>Visitor Logs</h2><p>Data of who enters the web by their name and time.</p></div></header>
    
    <div className="visitor-logs-grid">
      {logs.map((log) => (
        <article key={log.id} className="visitor-log-card">
          <div className="visitor-avatar">
            {getInitials(log.name)}
          </div>
          <div className="visitor-details">
            <strong>{log.name}</strong>
            <span>{formatAdminDate(log.created_at)}</span>
          </div>
        </article>
      ))}
      {!logs.length ? (
        <div className="visitor-logs-empty">No visitor logs recorded yet.</div>
      ) : null}
    </div>
  </section>;
}

function ScoreEditor({ team, rank, onSave }) {
  const [score, setScore] = useState(team.score);
  useEffect(() => setScore(team.score), [team.score]);
  return <article className="score-editor" style={{ '--team': team.color }}><div className="score-editor-top"><span>Rank {String(rank).padStart(2,'0')}</span><i /></div><h2>{team.name}</h2><ScorePercentage score={score} className="score-editor-percentage" /><label><span>Current score</span><input type="number" min="0" step="1" value={score} onChange={event => setScore(event.target.value)} /></label><button className="button button-light" type="button" onClick={() => onSave(team, score)}>Save score</button></article>;
}

function ScheduleTimeModal({ group, onSave, onClose }) {
  const [form, setForm] = useState({ key:group.key, start_time:group.start_time, end_time:group.end_time });
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    const closeOnEscape = event => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);
  const submit = async event => {
    event.preventDefault();
    setSaving(true);
    await onSave(form);
    setSaving(false);
  };
  return <div className="admin-program-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <form className="admin-program-modal admin-time-modal" role="dialog" aria-modal="true" aria-labelledby="admin-time-modal-title" onSubmit={submit}>
      <header><div><p className="overline">Schedule settings</p><h2 id="admin-time-modal-title">Edit {group.label} time</h2><small>Changes appear immediately on the public schedule.</small></div><button type="button" aria-label="Close time editor" onClick={onClose}>×</button></header>
      <div className="admin-time-fields">
        <label><span>Start time</span><input required type="time" value={form.start_time} onChange={event => setForm(current => ({ ...current, start_time:event.target.value }))} /></label>
        <label><span>End time</span><input required type="time" value={form.end_time} min={form.start_time} onChange={event => setForm(current => ({ ...current, end_time:event.target.value }))} /></label>
        <p>Current range: <strong>{displayTime(form.start_time)} - {displayTime(form.end_time)}</strong></p>
        <button className="button button-light" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save schedule time'}</button>
      </div>
    </form>
  </div>;
}

const emptyProgram = { title:'', category:'', session:'subahi', start_time:'05:00', duration_minutes:20, venue:'Main Auditorium', status:'upcoming' };
function ProgramForm({ program, scheduleGroups, onSave, onCancel }) {
  const [form, setForm] = useState(emptyProgram);
  const scheduleSignature = scheduleGroups.map(group => `${group.key}:${group.start_time}:${group.end_time}`).join('|');
  useEffect(() => setForm(program ? { ...program } : { ...emptyProgram, session:scheduleGroups[0].key, start_time:scheduleGroups[0].defaultTime }), [program, scheduleSignature]);
  const field = (name, value) => setForm(current => ({ ...current, [name]: value }));
  const scheduleGroupByKey = Object.fromEntries(scheduleGroups.map(group => [group.key, group]));
  const selectedGroup = scheduleGroupByKey[form.session] || scheduleGroups[0];
  const changeSession = session => {
    const group = scheduleGroupByKey[session];
    setForm(current => ({ ...current, session, start_time: group.defaultTime }));
  };
  return <form className="program-form" onSubmit={event => { event.preventDefault(); onSave(form); }}>
    <div className="program-form-head"><div><p className="overline">{program ? 'Edit record' : 'New schedule item'}</p><h2>{program ? 'Update program' : 'Add a program'}</h2></div>{program ? <button type="button" onClick={onCancel}>Cancel</button> : null}</div>
    <label className="wide"><span>Program title</span><input required value={form.title} onChange={e => field('title', e.target.value)} placeholder="e.g. Arabic Speech" /></label>
    <label><span>Category</span><input required value={form.category} onChange={e => field('category', e.target.value)} placeholder="Senior category" /></label>
    <label><span>Venue</span><input required value={form.venue} onChange={e => field('venue', e.target.value)} /></label>
    <label><span>Schedule block</span><select value={form.session} onChange={e => changeSession(e.target.value)}>{scheduleGroups.map(group => <option key={group.key} value={group.key}>{group.label} · {group.range}</option>)}</select></label>
    <label><span>Start time</span><input required type="time" min={selectedGroup.min} max={selectedGroup.max} value={form.start_time} onChange={e => field('start_time', e.target.value)} /><small>{selectedGroup.range}</small></label>
    <label><span>Duration</span><input required type="number" min="1" value={form.duration_minutes} onChange={e => field('duration_minutes', e.target.value)} /></label>
    <label><span>Status</span><select value={form.status} onChange={e => field('status', e.target.value)}><option value="upcoming">Upcoming</option><option value="live">Live</option><option value="completed">Completed</option></select></label>
    <button className="button button-light wide" type="submit">{program ? 'Save changes' : 'Add program'}</button>
  </form>;
}

const emptyParticipant = { name:'', code:'', team_id:'', program_id:'', category:'Senior', reporting_time:'09:00' };
function ParticipantForm({ participant, teams, programs, defaultProgramId, onSave, onCancel }) {
  const [form, setForm] = useState(emptyParticipant);
  useEffect(() => {
    if (!participant) { setForm({ ...emptyParticipant, team_id:teams[0]?.id || '', program_id:defaultProgramId || programs[0]?.id || '' }); return; }
    setForm({ ...participant, team_id:participant.team_id || teams.find(team => team.name === participant.team_name)?.id || '', program_id:participant.program_id || programs.find(program => program.title === participant.program)?.id || '' });
  }, [participant, teams, programs, defaultProgramId]);
  const field = (name, value) => setForm(current => ({ ...current, [name]:value }));
  return <form className="program-form participant-form" onSubmit={async event => {
    event.preventDefault();
    const saved = await onSave(form);
    if (saved && !participant) setForm({ ...emptyParticipant, team_id:teams[0]?.id || '', program_id:defaultProgramId || programs[0]?.id || '' });
  }}>
    <div className="program-form-head"><div><p className="overline">Participants page</p><h2>{participant ? 'Update participant' : 'Add a participant'}</h2></div>{participant ? <button type="button" onClick={onCancel}>Cancel</button> : null}</div>
    <p className="participant-publish-note wide">Students added here are published to the fourth-page participant directory.</p>
    <label className="wide"><span>Full name</span><input required value={form.name} onChange={e => field('name',e.target.value)} placeholder="Student name" /></label>
    <label><span>Chess Number</span><input required value={form.code} onChange={e => field('code',e.target.value)} placeholder="KZ-005" /></label>
    <label><span>Category</span><select required value={form.category} onChange={e => field('category',e.target.value)}><option value="Sub Junior">Sub Junior</option><option value="Junior">Junior</option><option value="Senior">Senior</option></select></label>
    <label><span>Team</span><select required value={form.team_id} onChange={e => field('team_id',e.target.value)}>{teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
    <label><span>Participating program</span><select required value={form.program_id} onChange={e => field('program_id',e.target.value)}>{programs.map(program => <option key={program.id} value={program.id}>{program.title}</option>)}</select></label>
    <label className="wide"><span>Reporting time</span><input required type="time" value={form.reporting_time} onChange={e => field('reporting_time',e.target.value)} /></label>
    <button className="button button-light wide" type="submit">{participant ? 'Save participant' : 'Publish participant'}</button>
  </form>;
}

function AdminMetric({ title, value, detail }) {
  return (
    <article className="admin-metric reveal visible">
      <span>{title}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}

function Participants({ people, students = [] }) {
  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState(people[0]?.id);
  const [programFilter, setProgramFilter] = useState('all');
  const [studentQuery, setStudentQuery] = useState('');
  const [studentClass, setStudentClass] = useState('all');
  const now = useClock(false);
  const programNames = [...new Set(people.map(person => person.program).filter(Boolean))].sort();
  const visiblePeople = people.filter(person => (programFilter === 'all' || person.program === programFilter) && `${person.name} ${person.code}`.toLowerCase().includes(query.toLowerCase()));
  const active = people.find(person => person.id === activeId) || people[0];
  const studentClasses = [...new Set(students.map(student => Number(student.class_id)).filter(Boolean))].sort((a,b) => a-b);
  const visibleStudents = students.filter(student => {
    const needle = studentQuery.trim().toLowerCase();
    const matchesClass = studentClass === 'all' || Number(student.class_id) === Number(studentClass);
    const haystack = `${student.full_name || ''} ${student.display_name || ''} ${student.name_arabic || ''} ${student.chess_number || ''} ${student.place || ''}`.toLowerCase();
    return matchesClass && (!needle || haystack.includes(needle));
  });

  useEffect(() => {
    if (!activeId && people[0]) setActiveId(people[0].id);
  }, [activeId, people]);

  return (
    <section className="participant-shell section-wrap">
      <header className="participant-title reveal visible">
        <div><p className="overline">Live program</p><h1>{active?.program || 'Participants'}</h1><span>{active?.category || 'Festival'} · Main Auditorium</span></div>
        <div className="clock-block"><strong>{now}</strong><span>05 July 2026</span></div>
      </header>
      <div className="participant-layout">
        {active ? (
          <article className="speaker-card reveal visible">
            <span className="live-label"><i /> Speaking now</span>
            <div><p>{active.program} · {active.category}</p><h2>{active.name}</h2></div>
            <footer><strong>{active.reporting_time}</strong><span>{active.team_name} · {active.code}</span></footer>
          </article>
        ) : null}
        <aside className="participant-list reveal visible">
          <div className="list-head"><h2>Participants</h2><span>{people.length} speakers</span></div>
          <form className="participant-search" role="search" onSubmit={event => event.preventDefault()}>
            <input type="search" name="q" placeholder="Search name or ID" autoComplete="off" value={query} onChange={event => setQuery(event.target.value)} />
            <button aria-label="Search" type="submit"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6" /><path d="m16 16 4 4" /></svg></button>
          </form>
          <label className="participant-program-filter"><span>Program roster</span><select value={programFilter} onChange={event => {
            const value = event.target.value;
            setProgramFilter(value);
            const firstMatch = people.find(person => value === 'all' || person.program === value);
            if (firstMatch) setActiveId(firstMatch.id);
          }}><option value="all">All programs</option>{programNames.map(program => <option key={program} value={program}>{program}</option>)}</select></label>
          <div className="participant-results-scroll" data-participant-results>
            {visiblePeople.map((person, index) => (
              <button key={person.id} className={`participant-row ${person.id === active?.id ? 'active' : ''}`} type="button" onClick={() => setActiveId(person.id)}>
                <time>{person.reporting_time}</time>
                <span><strong>{person.name}</strong><small>{person.team_name} · {person.code}</small></span>
                <b>{String(index + 1).padStart(2, '0')}</b>
              </button>
            ))}
          </div>
          <p className="reporting-note">Reporting now: <strong>All {active?.program || 'festival'} participants</strong></p>
        </aside>
      </div>

      <section className="public-student-directory" aria-labelledby="all-students-title">
        <header><div><p className="overline">College master roster</p><h2 id="all-students-title">All Students</h2><p>Browse the complete Kauzariyya student directory.</p></div><strong>{visibleStudents.length}<small>of {students.length}</small></strong></header>
        <div className="public-student-filters">
          <label><span>Search students</span><input type="search" value={studentQuery} onChange={event => setStudentQuery(event.target.value)} placeholder="Name, chess number or place" /></label>
          <label><span>Class</span><select value={studentClass} onChange={event => setStudentClass(event.target.value)}><option value="all">All classes</option>{studentClasses.map(classId => <option key={classId} value={classId}>{collegeClassLabel(classId)}</option>)}</select></label>
        </div>
        <div className="public-student-grid">
          {visibleStudents.map(student => <article key={student.id || student.chess_number}>
            <b>{student.chess_number}</b>
            <div><h3>{student.display_name || student.full_name}</h3><p>{student.full_name}{student.name_arabic ? <span lang="ar" dir="rtl"> · {student.name_arabic}</span> : null}</p></div>
            <footer><span>{collegeClassLabel(student.class_id)}</span><span>{student.place || 'Place not set'}</span><i className={student.status}>{student.status || 'active'}</i></footer>
          </article>)}
          {!students.length ? <div className="public-student-empty"><strong>Loading student directory…</strong><span>The complete roster will appear here shortly.</span></div> : !visibleStudents.length ? <div className="public-student-empty"><strong>No matching students</strong><span>Try another name, chess number or class.</span></div> : null}
        </div>
      </section>
    </section>
  );
}


function MobileTabBar({ page, settings = {} }) {
  const tabs = [
    { key: 'home', href: publicHref('home'), label: 'Home', icon: 'home' },
    { key: 'scoreboard', href: publicHref('scoreboard'), label: 'Scores', icon: 'scores' },
    { key: 'schedule', href: publicHref('schedule'), label: 'Schedule', icon: 'schedule' },
    { key: 'participants', href: publicHref('participants'), label: 'Directory', icon: 'directory' },
    { key: 'musabaqa', href: publicHref('musabaqa'), label: 'Program Plan', icon: 'program' },
    { key: 'review', href: publicHref('review'), label: 'Review', icon: 'review' },
  ];

  return (
    <nav className="mobile-tabbar" aria-label="Mobile navigation">
      {tabs.filter(tab => tab.key !== 'schedule' || settings.schedule_visible !== false).filter(tab => tab.key !== 'participants' || settings.participants_visible !== false).filter(tab => tab.key !== 'review' || settings.reviews_enabled !== false).map(tab => (
        <a key={tab.key} href={tab.href} className={page === tab.key ? 'active' : ''}>
          <span className={`tab-glyph tab-${tab.icon}`} aria-hidden="true" />
          <span>{tab.label}</span>
        </a>
      ))}
    </nav>
  );
}

function SignupGate({ onComplete }) {
  const [name, setName] = useState('');
  const submit = event => {
    event.preventDefault();
    const clean = name.trim().replace(/\s+/g, ' ');
    if (clean.length < 2) return;
    window.localStorage.setItem('kauzariyya-visitor', clean);
    fetch(apiEndpoint('visitor-logs'), {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: clean })
    }).catch(() => {});
    onComplete(clean);
  };
  return <div className="signup-gate">
    <div className="signup-backdrop" />
    <section className="signup-card reveal visible">
      <div className="signup-brand"><img src="assets/kauzariyya-brand-icon.png" alt="Kauzariyya" /><span>Arts Festival 2026</span></div>
      <p className="overline">Welcome to Kauzariyya</p>
      <h1><span>Your festival</span><em>starts here.</em></h1>
      <p>Enter your name to personalize your festival experience. No password or email is required.</p>
      <form onSubmit={submit}><label htmlFor="visitor-name">Your name</label><input id="visitor-name" autoFocus autoComplete="name" value={name} onChange={event => setName(event.target.value)} placeholder="Enter your full name" minLength="2" required /><button className="button button-light" type="submit">Enter the festival <span>→</span></button></form>
      <small>By continuing, your name is saved only on this device.</small>
    </section>
  </div>;
}

function App() {
  const initial = useMemo(readInitialData, []);
  const [page, setPage] = useState(() => pageFromLocation() || initial.page || 'home');
  const data = useFestivalData(initial, page);
  const [visitor, setVisitor] = useState(() => window.localStorage.getItem('kauzariyya-visitor') || '');

  useEffect(() => {
    const routeByPage = { home: publicHref('home'), scoreboard: publicHref('scoreboard'), schedule: publicHref('schedule'), participants: publicHref('participants'), musabaqa: publicHref('musabaqa'), review: publicHref('review'), admin: publicHref('admin') };
    const onClick = event => {
      const anchor = event.target.closest('a[href]');
      if (!anchor || anchor.target || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      const nextPage = pageForPath(url.pathname);
      if (!nextPage) return;
      event.preventDefault();
      window.history.pushState({}, '', routeByPage[nextPage]);
      setPage(nextPage);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    const onPop = () => setPage(pageFromLocation() || initial.page || 'home');
    document.addEventListener('click', onClick);
    window.addEventListener('popstate', onPop);
    return () => {
      document.removeEventListener('click', onClick);
      window.removeEventListener('popstate', onPop);
    };
  }, []);

  useEffect(() => {
    document.body.className = `page-${page}`;
    document.querySelectorAll('.site-nav a').forEach(link => {
      const url = new URL(link.href, window.location.href);
      link.classList.toggle('active', pageForPath(url.pathname) === page);
    });
  }, [page]);

  useEffect(() => {
    document.documentElement.classList.toggle('site-motion-disabled', data.settings.animations_enabled === false);
  }, [data.settings.animations_enabled]);

  useEffect(() => {
    const visibility = { schedule:data.settings.schedule_visible !== false, participants:data.settings.participants_visible !== false, review:data.settings.reviews_enabled !== false };
    document.querySelectorAll('.site-nav a').forEach(link => {
      const linkedPage = pageForPath(new URL(link.href, window.location.href).pathname);
      if (linkedPage in visibility) link.hidden = !visibility[linkedPage];
    });
  }, [data.settings.schedule_visible, data.settings.participants_visible, data.settings.reviews_enabled]);

  let view;
  if (page === 'scoreboard') view = <Scoreboard teams={data.teams} settings={data.settings} />;
  else if (page === 'schedule') view = data.settings.schedule_visible === false ? <PublicSectionUnavailable title="Schedule unavailable" copy="The public festival schedule is currently unpublished." /> : <Schedule items={data.schedule} blocks={data.settings.schedule_blocks} />;
  else if (page === 'participants') view = data.settings.participants_visible === false ? <PublicSectionUnavailable title="Directory unavailable" copy="The participant directory is currently unpublished." /> : <Participants people={data.participants} students={data.students} />;
  else if (page === 'musabaqa') view = <MusabaqaPlan />;
  else if (page === 'review') view = <Review enabled={data.settings.reviews_enabled !== false} />;
  else if (page === 'admin') view = <Admin data={data} />;
  else view = <Home data={data} visitor={visitor} />;

  if (!visitor) return <SignupGate onComplete={setVisitor} />;

  return (
    <>
      {page !== 'admin' ? <SiteAnnouncement settings={data.settings} /> : null}
      {view}
      <MobileTabBar page={page} settings={data.settings} />
    </>
  );
}

const root = document.getElementById('react-root');
if (root) createRoot(root).render(<App />);
