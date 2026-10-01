(() => {
    const section = document.getElementById('futbol');
    const toggle = document.getElementById('futbol-language-toggle');
    const panel = document.getElementById('futbol-languages');
    const select = document.getElementById('futbol-language');
    // Only the Futbol section is translated; member content is never rewritten.
    const translations = {
        en: ['South America & Europe', 'Fan, Player & Manager Profiles', 'Find School, College, and Professional teams. Add your team, interact, and earn points and rewards.', 'Points may be redeemed for tickets. Conditions apply.', 'Fan profile', 'Player profile', 'Manager profile', 'Browse Futbol teams', 'Add your team', 'Ticket reward conditions', 'Ticket redemption depends on participating reward offers, event availability, point requirements, and approval. Each available offer will state its requirements before you redeem. Points do not guarantee a ticket. Stars are recognition and are tracked separately from points.'],
        es: ['Sudamérica y Europa', 'Perfiles de aficionados, jugadores y entrenadores', 'Encuentra equipos escolares, universitarios y profesionales. Añade tu equipo, interactúa y gana puntos y recompensas.', 'Los puntos pueden canjearse por entradas. Se aplican condiciones.', 'Perfil de aficionado', 'Perfil de jugador', 'Perfil de entrenador', 'Explorar equipos de fútbol', 'Añadir tu equipo', 'Condiciones de las entradas', 'El canje depende de las ofertas participantes, la disponibilidad, los puntos requeridos y la aprobación. Cada oferta indicará sus requisitos antes del canje. Los puntos no garantizan una entrada. Las estrellas son reconocimientos y se contabilizan por separado.'],
        pt: ['América do Sul e Europa', 'Perfis de torcedores, jogadores e treinadores', 'Encontre equipes escolares, universitárias e profissionais. Adicione sua equipe, interaja e ganhe pontos e recompensas.', 'Os pontos podem ser trocados por ingressos. Aplicam-se condições.', 'Perfil de torcedor', 'Perfil de jogador', 'Perfil de treinador', 'Explorar equipes de futebol', 'Adicionar sua equipe', 'Condições dos ingressos', 'A troca depende das ofertas participantes, da disponibilidade, dos pontos necessários e da aprovação. Cada oferta informará seus requisitos antes da troca. Os pontos não garantem um ingresso. As estrelas são reconhecimentos e são contabilizadas separadamente.'],
        fr: ['Amérique du Sud et Europe', 'Profils de supporters, joueurs et entraîneurs', 'Découvrez des équipes scolaires, universitaires et professionnelles. Ajoutez votre équipe, échangez et gagnez des points et des récompenses.', 'Les points peuvent être échangés contre des billets. Sous conditions.', 'Profil de supporter', 'Profil de joueur', 'Profil d’entraîneur', 'Explorer les équipes de football', 'Ajouter votre équipe', 'Conditions des billets', 'L’échange dépend des offres participantes, des disponibilités, des points requis et de l’approbation. Chaque offre indiquera ses conditions avant l’échange. Les points ne garantissent pas un billet. Les étoiles sont des marques de reconnaissance comptabilisées séparément.'],
        de: ['Südamerika und Europa', 'Profile für Fans, Spieler und Trainer', 'Entdecke Schul-, Hochschul- und Profiteams. Füge dein Team hinzu, tausche dich aus und sammle Punkte und Prämien.', 'Punkte können gegen Tickets eingelöst werden. Es gelten Bedingungen.', 'Fanprofil', 'Spielerprofil', 'Trainerprofil', 'Fußballteams entdecken', 'Dein Team hinzufügen', 'Ticketbedingungen', 'Die Einlösung hängt von teilnehmenden Angeboten, Verfügbarkeit, erforderlichen Punkten und Genehmigung ab. Jedes Angebot nennt vor der Einlösung seine Bedingungen. Punkte garantieren kein Ticket. Sterne dienen der Anerkennung und werden getrennt gezählt.'],
        it: ['Sud America ed Europa', 'Profili di tifosi, giocatori e allenatori', 'Trova squadre scolastiche, universitarie e professionistiche. Aggiungi la tua squadra, interagisci e guadagna punti e premi.', 'I punti possono essere riscattati per biglietti. Si applicano condizioni.', 'Profilo tifoso', 'Profilo giocatore', 'Profilo allenatore', 'Esplora le squadre di calcio', 'Aggiungi la tua squadra', 'Condizioni dei biglietti', 'Il riscatto dipende dalle offerte aderenti, dalla disponibilità, dai punti richiesti e dall’approvazione. Ogni offerta indicherà i requisiti prima del riscatto. I punti non garantiscono un biglietto. Le stelle sono riconoscimenti conteggiati separatamente.']
    };
    const nodes = [...section.querySelectorAll(':scope > p'), ...section.querySelectorAll('[data-futbol-profile], #futbol-browse, #futbol-add-team'), section.querySelector('details summary'), section.querySelector('details p')];
    function apply(language) {
        const code = Object.hasOwn(translations, language) ? language : 'en';
        nodes.forEach((node, i) => { node.textContent = translations[code][i]; });
        section.lang = code;
        select.value = code;
        toggle.setAttribute('aria-label', {en:'Futbol languages',es:'Idiomas de fútbol',pt:'Idiomas do futebol',fr:'Langues du football',de:'Fußballsprachen',it:'Lingue del calcio'}[code]);
    }
    toggle.addEventListener('click', () => {
        panel.hidden = !panel.hidden;
        toggle.setAttribute('aria-expanded', String(!panel.hidden));
        if (!panel.hidden) select.focus();
    });
    select.addEventListener('change', () => {
        apply(select.value);
        try { localStorage.setItem('fanyou-futbol-language', select.value); } catch {}
    });
    let saved = 'en';
    try { saved = localStorage.getItem('fanyou-futbol-language') || 'en'; } catch {}
    apply(saved);
})();
