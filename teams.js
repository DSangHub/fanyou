(() => {
    'use strict';
    const SPORTS = ['Archery', 'Badminton', 'Baseball', 'Basketball', 'Beach Volleyball', 'Bowling', 'Cheerleading', 'Cross Country', 'Cycling', 'Dance', 'Diving', 'Esports', 'Fencing', 'Field Hockey', 'Flag Football', 'Football', 'Golf', 'Gymnastics', 'Ice Hockey', 'Lacrosse', 'Rifle', 'Rowing', 'Rugby', 'Sailing', 'Skiing', 'Soccer', 'Softball', 'Squash', 'Swimming', 'Swimming & Diving', 'Tennis', 'Track & Field', 'Triathlon', 'Volleyball', 'Water Polo', 'Weightlifting', 'Wrestling', 'Other'];
    const KEY = 'fanyou-school-teams-v1';
    const STARTER_CLUBS = [
        {id:'futbol-barcelona',school:'FC Barcelona',city:'Barcelona',region:'Spain',area:'Europe',source:'https://www.fcbarcelona.com/en/football'},
        {id:'futbol-real-madrid',school:'Real Madrid',city:'Madrid',region:'Spain',area:'Europe',source:'https://www.realmadrid.com/en-US'},
        {id:'futbol-river-plate',school:'River Plate',city:'Buenos Aires',region:'Argentina',area:'South America',source:'https://www.cariverplate.com.ar/'},
        {id:'futbol-flamengo',school:'Flamengo',city:'Rio de Janeiro',region:'Brazil',area:'South America',source:'https://www.flamengo.com.br/'}
    ].map(t=>({...t,mascot:'',sport:'Soccer',level:'Professional',category:'Open',division:'Professional',followed:false}));
    const EXTRA_TEAMS = [
        {id:'football-49ers',school:'San Francisco 49ers',sport:'Football',city:'Santa Clara',region:'CA',source:'https://www.49ers.com/'},
        {id:'baseball-dodgers',school:'Los Angeles Dodgers',sport:'Baseball',city:'Los Angeles',region:'CA',source:'https://www.mlb.com/dodgers'},
        {id:'basketball-lakers',school:'Los Angeles Lakers',sport:'Basketball',city:'Los Angeles',region:'CA',source:'https://www.nba.com/lakers/'},
        {id:'hockey-kings',school:'Los Angeles Kings',sport:'Ice Hockey',city:'Los Angeles',region:'CA',source:'https://www.nhl.com/kings/'},
        {id:'college-fresno-football',school:'Fresno State',mascot:'Bulldogs',sport:'Football',level:'College',division:'NCAA Division I',city:'Fresno',region:'CA',source:'https://gobulldogs.com/sports/football'}
    ].map(t=>({mascot:'',area:'Other',level:'Professional',category:'Open',division:'Professional',followed:false,...t}));
    const STARTER_TEAMS = [...STARTER_CLUBS, ...EXTRA_TEAMS];
    const form = document.getElementById('team-form');
    const list = document.getElementById('team-list');
    const status = document.getElementById('team-status');
    const level = document.getElementById('team-level-filter');
    const sport = document.getElementById('team-sport-filter');
    const area = document.getElementById('team-area-filter');
    const search = document.getElementById('team-search');
    const following = document.getElementById('team-following-filter');
    let teams = [];
    let storageAvailable = true;
    const validTeam = t => t && ['id', 'school', 'sport', 'category', 'division', 'city', 'region'].every(k => typeof t[k] === 'string' && t[k].trim().length > 0 && t[k].length <= 150) && ['High School', 'School', 'College', 'Professional'].includes(t.level) && typeof t.mascot==='string' && t.mascot.length<=80 && (t.area===undefined || ['', 'South America', 'Europe', 'Other'].includes(t.area)) && typeof t.followed === 'boolean';
    try {
        const saved = JSON.parse(localStorage.getItem(KEY) || '[]');
        teams = Array.isArray(saved) ? saved.filter(validTeam) : [];
    } catch { storageAvailable = false; }
    for(const seed of STARTER_TEAMS)if(!teams.some(t=>t.id===seed.id||(t.school.toLocaleLowerCase()===seed.school.toLocaleLowerCase()&&t.level===seed.level&&t.sport===seed.sport)))teams.push({...seed});
    function option(value) { return new Option(value, value); }
    SPORTS.forEach(s => form.elements.sport.add(s==='Soccer'?new Option('Soccer / Futbol','Soccer'):option(s)));
    function sportFilters() {
        const selected = sport.value;
        sport.replaceChildren(new Option('All sports', ''));
        [...new Set([...SPORTS, ...teams.map(t => t.sport)])].sort().forEach(s => sport.add(option(s)));
        sport.value = [...sport.options].some(o => o.value === selected) ? selected : '';
    }
    function schoolFields() {
        const highSchool = ['High School','School'].includes(form.elements.level.value);
        const professional = form.elements.level.value === 'Professional';
        form.elements.category.replaceChildren(...(highSchool ? ['Boys', 'Girls', 'Coed / Mixed', 'Open'] : ['Men', 'Women', 'Coed / Mixed', 'Open']).map(option));
        form.elements.division.replaceChildren(...(highSchool ? ['Varsity', 'Junior Varsity', 'Freshman', 'Club / Other'] : professional ? ['Professional','Academy / Development','Club / Other'] : ['NCAA Division I', 'NCAA Division II', 'NCAA Division III', 'NAIA', 'NJCAA / Junior College', 'Community College', 'University / College (International)', 'Club / Other']).map(option));
    }
    function persist() {
        try { localStorage.setItem(KEY, JSON.stringify(teams)); storageAvailable = true; }
        catch { storageAvailable = false; }
    }
    function render() {
        const query = search.value.trim().toLocaleLowerCase();
        const visible = teams.filter(t => (!level.value || t.level === level.value) && (!sport.value || t.sport === sport.value) && (!area.value || t.area === area.value) && (!following.checked || t.followed) && [t.school, t.mascot, t.city, t.region, t.sport].join(' ').toLocaleLowerCase().includes(query));
        list.replaceChildren();
        status.textContent = `${visible.length} team${visible.length === 1 ? '' : 's'} shown · ${teams.filter(t => t.followed).length} followed${storageAvailable ? '' : ' · Saving is unavailable. Changes last only for this visit.'}`;
        updatePicker();
        if (!visible.length) {
            const empty = document.createElement('p');
            empty.className = 'text-sm text-slate-400 sm:col-span-2 lg:col-span-3 py-4';
            empty.textContent = teams.length ? 'No matching teams. Change your filters or add a team below.' : 'Start by adding your school team below. Every sport is welcome.';
            list.append(empty);
        }
        visible.forEach(t => {
            const card = document.createElement('article');
            card.className = 'bg-slate-950 border border-slate-700 rounded-xl p-4 space-y-2';
            const title = document.createElement('h2');
            title.className = 'font-bold break-words';
            title.textContent = `${t.school} ${t.mascot}`.trim();
            const detail = document.createElement('p');
            detail.className = 'text-sm text-indigo-300 break-words';
            detail.textContent = `${t.level} · ${t.sport} · ${t.category} · ${t.division}`;
            const place = document.createElement('p');
            place.className = 'text-sm text-slate-400 break-words';
            place.textContent = `${t.city}, ${t.region}${t.area ? ` · ${t.area}` : ''}`;
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'rounded-lg bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-sm font-semibold';
            button.textContent = t.followed ? 'Following — unfollow' : 'Follow team';
            button.setAttribute('aria-pressed', String(t.followed));
            button.setAttribute('aria-label', `${t.followed ? 'Unfollow' : 'Follow'} ${t.school} ${t.mascot}, ${t.sport}, ${t.category}`);
            button.addEventListener('click', () => { t.followed = !t.followed; persist(); render(); });
            card.append(title, detail, place, button);
            const club=STARTER_TEAMS.find(seed=>seed.id===t.id);
            if(club){const source=document.createElement('a');source.href=club.source;source.target='_blank';source.rel='noopener noreferrer';source.className='block text-xs text-slate-400 underline';source.textContent='Official team website · discovery listing';card.append(source);}
            list.append(card);
        });
    }
    form.elements.level.addEventListener('change', schoolFields);
    form.elements.sport.addEventListener('change', () => {
        const other = form.elements.sport.value === 'Other';
        document.getElementById('team-other-label').classList.toggle('hidden', !other);
        form.elements.otherSport.disabled = !other;
        form.elements.otherSport.required = other;
    });
    form.addEventListener('submit', e => {
        e.preventDefault();
        if (!form.reportValidity()) return;
        const get = name => form.elements[name].value.trim();
        const team = { id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`, school: get('school'), mascot: get('mascot'), level: get('level'), sport: get('sport') === 'Other' ? get('otherSport') : get('sport'), category: get('category'), division: get('division'), city: get('city'), region: get('region'), area:get('area'), followed: true };
        if (!validTeam(team)) { status.textContent = 'Please enter a name and location using more than spaces.'; return; }
        const signature = t => JSON.stringify(['school', 'mascot', 'level', 'sport', 'category', 'division', 'city', 'region'].map(k => t[k].toLocaleLowerCase()));
        const existing = teams.find(t => signature(t) === signature(team));
        if (existing) existing.followed = true; else teams.push(team);
        persist();
        sportFilters();
        level.value = team.level;
        sport.value = team.sport;
        area.value=team.area;
        search.value = '';
        following.checked = false;
        render();
        status.textContent += existing ? ' · Team already exists; now followed.' : ' · Team added and followed.';
    });
    [level, sport, area, following].forEach(el => el.addEventListener('change', render));
    search.addEventListener('input', render);
    document.getElementById('futbol-browse').addEventListener('click',()=>{sport.value='Soccer';level.value='';area.value='';following.checked=false;search.value='';render();document.getElementById('teams-heading').scrollIntoView({behavior:'smooth'});});
    document.getElementById('futbol-add-team').addEventListener('click',()=>{form.elements.sport.value='Soccer';form.elements.sport.dispatchEvent(new Event('change'));form.closest('details').open=true;form.scrollIntoView({behavior:'smooth'});form.elements.school.focus();});
    const picker = document.getElementById('sport-team-picker');
    const choice = document.getElementById('sport-team-choice');
    const pickerStatus = document.getElementById('sport-picker-status');
    const customName = document.getElementById('sport-custom-name');
    const navButtons = [...document.querySelectorAll('[data-sport-nav]')];
    const levelButtons = [...document.querySelectorAll('[data-picker-level]')];
    let pickedSport = 'Football', pickedLevel = 'High School', activeNav = null;
    function selectedSport() { return pickedSport === 'Other' ? customName.value.trim() : pickedSport; }
    function matches(t) { return t.level === pickedLevel && t.sport.toLocaleLowerCase() === selectedSport().toLocaleLowerCase(); }
    function updatePicker() {
        const prior = choice.value;
        const matchesList = teams.filter(matches);
        choice.replaceChildren(new Option(matchesList.length ? 'Choose a team' : 'No teams listed yet — write in your team', ''));
        matchesList.sort((a,b)=>a.school.localeCompare(b.school)).forEach(t=>choice.add(new Option(`${t.school} ${t.mascot} · ${t.city}, ${t.region}`.trim(),t.id)));
        choice.value = matchesList.some(t=>t.id===prior) ? prior : '';
        document.getElementById('sport-team-follow').disabled = !choice.value;
        pickerStatus.textContent = `${matchesList.length} ${pickedLevel} team${matchesList.length===1?'':'s'} available. Missing your team? Write it in below.`;
    }
    function filterPicker() {
        sportFilters();
        const value = selectedSport();
        if (value && ![...sport.options].some(o=>o.value===value)) sport.add(option(value));
        sport.value=value;
        level.value=pickedLevel;area.value='';search.value='';following.checked=false;
        levelButtons.forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.pickerLevel===pickedLevel)));
        render();
    }
    function closePicker(focus=true) {
        picker.hidden=true;
        navButtons.forEach(button=>button.setAttribute('aria-expanded','false'));
        if(focus) activeNav?.focus();
    }
    navButtons.forEach(button=>button.addEventListener('click',()=>{
        if(activeNav===button && !picker.hidden){closePicker();return;}
        activeNav=button;pickedSport=button.dataset.sportNav;pickedLevel='High School';picker.hidden=false;
        navButtons.forEach(b=>b.setAttribute('aria-expanded',String(b===button)));
        document.getElementById('sport-picker-heading').textContent=`${button.textContent} — choose your team`;
        document.getElementById('sport-custom-label').hidden=pickedSport!=='Other';
        document.getElementById('sport-picker-language').hidden=pickedSport!=='Soccer';
        filterPicker();
        (pickedSport==='Other'?customName:levelButtons[0]).focus();
    }));
    levelButtons.forEach(button=>button.addEventListener('click',()=>{pickedLevel=button.dataset.pickerLevel;filterPicker();}));
    customName.addEventListener('input',filterPicker);
    choice.addEventListener('change',()=>{document.getElementById('sport-team-follow').disabled=!choice.value;});
    document.getElementById('sport-team-follow').addEventListener('click',()=>{
        const team=teams.find(t=>t.id===choice.value && matches(t));if(!team)return;
        team.followed=true;persist();render();pickerStatus.textContent=`Following ${team.school}. ${storageAvailable?'Saved on this device.':'Saving unavailable; followed for this visit.'}`;
    });
    document.getElementById('sport-team-write').addEventListener('click',()=>{
        if(pickedSport==='Other' && !selectedSport()){pickerStatus.textContent='Enter your sport name first.';customName.focus();return;}
        form.elements.level.value=pickedLevel;schoolFields();
        const name=selectedSport();
        const known=SPORTS.includes(name)&&name!=='Other';
        form.elements.sport.value=known?name:'Other';form.elements.otherSport.value=known?'':name;
        form.elements.sport.dispatchEvent(new Event('change'));
        document.getElementById('team-write-in').open=true;
        form.scrollIntoView({behavior:'smooth',block:'center'});form.elements.school.focus();
    });
    document.getElementById('sport-picker-close').addEventListener('click',()=>closePicker());
    picker.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();closePicker();}});
    document.getElementById('sport-picker-language').addEventListener('click',()=>{
        document.getElementById('futbol').scrollIntoView({behavior:'smooth'});
        if(document.getElementById('futbol-languages').hidden) document.getElementById('futbol-language-toggle').click();
        document.getElementById('futbol-language').focus();
    });
    schoolFields();
    sportFilters();
    render();
})();
