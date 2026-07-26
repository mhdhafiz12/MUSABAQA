(() => {
  document.documentElement.classList.add('js-ready');

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const limitedDevice = connection?.saveData || (navigator.deviceMemory && navigator.deviceMemory <= 4) || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4);
  document.documentElement.classList.toggle('performance-lite', Boolean(limitedDevice || reducedMotion));

  const backgroundVideo = document.querySelector('[data-background-video]');
  const pageUsesBackgroundVideo = () => document.body.classList.contains('page-home');
  const startBackgroundVideo = () => {
    if (!backgroundVideo || backgroundVideo.src || !backgroundVideo.dataset.src || connection?.saveData || reducedMotion || !pageUsesBackgroundVideo()) return;
    backgroundVideo.src = backgroundVideo.dataset.src;
    backgroundVideo.load();
    backgroundVideo.play().catch(() => {});
  };
  if (backgroundVideo) {
    startBackgroundVideo();
    new MutationObserver(() => {
      if (pageUsesBackgroundVideo()) startBackgroundVideo();
      else backgroundVideo.pause();
    }).observe(document.body, { attributes:true, attributeFilter:['class'] });
  }

  const setPageVisibility = () => {
    const idle = document.hidden;
    document.documentElement.classList.toggle('page-idle', idle);
    if (!backgroundVideo?.src) return;
    if (idle || !pageUsesBackgroundVideo()) backgroundVideo.pause();
    else backgroundVideo.play().catch(() => {});
  };
  document.addEventListener('visibilitychange', setPageVisibility, { passive:true });

  const header = document.querySelector('.site-header');
  const setHeaderState = () => header?.classList.toggle('is-scrolled', window.scrollY > 12);
  setHeaderState();
  let headerFrame = 0;
  window.addEventListener('scroll', () => {
    if (headerFrame) return;
    headerFrame = window.requestAnimationFrame(() => {
      headerFrame = 0;
      setHeaderState();
    });
  }, { passive: true });



  const menu = document.querySelector('.menu-toggle');
  const nav = document.querySelector('.site-nav');
  menu?.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    menu.setAttribute('aria-expanded', String(open));
  });
  nav?.querySelectorAll('a').forEach(link => link.addEventListener('click', () => {
    nav.classList.remove('open');
    menu?.setAttribute('aria-expanded', 'false');
  }));

  document.querySelector('[data-visitor-logout]')?.addEventListener('click', () => {
    localStorage.removeItem('kauzariyya-visitor');
    sessionStorage.removeItem('kauzariyya-admin');
    window.location.assign('/');
  });

  const routeLinks = [...document.querySelectorAll('.site-nav a[href^="#"]')];
  const routeSections = routeLinks
    .map(link => document.querySelector(link.getAttribute('href')))
    .filter(Boolean);
  if (routeLinks.length && routeSections.length) {
    const setActiveRoute = () => {
      const current = routeSections
        .filter(section => section.getBoundingClientRect().top <= 130)
        .at(-1) || routeSections[0];
      routeLinks.forEach(link => link.classList.toggle('active', link.getAttribute('href') === `#${current.id}`));
    };
    setActiveRoute();
    let routeFrame = 0;
    window.addEventListener('scroll', () => {
      if (routeFrame) return;
      routeFrame = window.requestAnimationFrame(() => {
        routeFrame = 0;
        setActiveRoute();
      });
    }, { passive: true });
  }

  if (window.matchMedia('(pointer:fine)').matches && !reducedMotion && !limitedDevice) {
    document.querySelectorAll('.magnetic').forEach(item => {
      let pointerFrame = 0;
      item.addEventListener('pointermove', event => {
        if (pointerFrame) return;
        const clientX = event.clientX;
        const clientY = event.clientY;
        pointerFrame = window.requestAnimationFrame(() => {
          pointerFrame = 0;
          const rect = item.getBoundingClientRect();
          const x = (clientX - rect.left - rect.width / 2) * .12;
          const y = (clientY - rect.top - rect.height / 2) * .18;
          item.style.transform = `translate(${x}px, ${y}px) translateY(-3px)`;
        });
      });
      item.addEventListener('pointerleave', () => {
        window.cancelAnimationFrame(pointerFrame);
        pointerFrame = 0;
        item.style.transform = '';
      });
    });
  }

  const revealItems = [...document.querySelectorAll('.reveal')];
  const revealIndexes = new Map(revealItems.map((item, index) => [item, index]));
  const observer = new IntersectionObserver(entries => entries.forEach(entry => {
    if (entry.isIntersecting) {
      const index = revealIndexes.get(entry.target) || 0;
      entry.target.style.transitionDelay = `${Math.min(index % 4, 3) * 70}ms`;
      entry.target.classList.add('visible');
      observer.unobserve(entry.target);
    }
  }), { threshold: .12 });
  revealItems.forEach(el => observer.observe(el));



  const setupNextGenMotion = () => {
    if (reducedMotion || limitedDevice || !('IntersectionObserver' in window)) return;

    document.documentElement.classList.add('nextgen-motion-ready');

    const aurora = document.createElement('div');
    aurora.className = 'motion-aurora';
    aurora.setAttribute('aria-hidden', 'true');
    aurora.innerHTML = '<i></i><i></i>';
    document.body.appendChild(aurora);

    const progress = document.createElement('span');
    progress.className = 'motion-scroll-progress';
    progress.setAttribute('aria-hidden', 'true');
    document.body.appendChild(progress);

    let scrollFrame = 0;
    const updateScrollProgress = () => {
      scrollFrame = 0;
      const available = document.documentElement.scrollHeight - window.innerHeight;
      const value = available > 0 ? Math.min(1, Math.max(0, window.scrollY / available)) : 0;
      progress.style.transform = `scaleX(${value})`;
    };
    window.addEventListener('scroll', () => {
      if (!scrollFrame) scrollFrame = window.requestAnimationFrame(updateScrollProgress);
    }, { passive:true });
    updateScrollProgress();

    const motionSelector = [
      '.home-platform-statement',
      '.home-musabaqa-about',
      '.home-story-visual',
      '.home-story-content',
      '.home-access > header',
      '.home-access-grid > a',
      '.home-event-highlights > header',
      '.home-event-highlights article',
      '.leader-feature',
      '.ranking-panel',
      '.schedule-head',
      '.schedule-column',
      '.participant-title',
      '.participant-programs',
      '.speaker-card',
      '.directory-chapter-heading',
      '.public-student-directory',
      '.review-copy',
      '.review-card',
      '.home-footer-location',
      '.home-footer-identity',
      '.simple-social-icons'
    ].join(',');
    const depthSelector = '.leader-feature,.ranking-panel,.schedule-column,.speaker-card,.review-card,.home-footer-location';
    const prepared = new WeakSet();
    const motionObserver = new IntersectionObserver(entries => entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('motion-in');
      motionObserver.unobserve(entry.target);
    }), { threshold:.08, rootMargin:'0px 0px -4% 0px' });

    const prepareMotion = root => {
      const elements = [];
      if (root.nodeType === 1 && root.matches?.(motionSelector)) elements.push(root);
      root.querySelectorAll?.(motionSelector).forEach(element => elements.push(element));
      elements.forEach((element, index) => {
        if (prepared.has(element)) return;
        prepared.add(element);
        element.classList.add('motion-item');
        element.style.setProperty('--motion-delay', `${Math.min(index % 5, 4) * 75}ms`);
        element.style.setProperty('--motion-x', `${index % 2 ? 18 : -18}px`);
        if (element.matches(depthSelector)) element.classList.add('motion-depth');
        motionObserver.observe(element);
      });
    };

    const reactRoot = document.getElementById('react-root');
    if (reactRoot) {
      prepareMotion(reactRoot);
      let mutationFrame = 0;
      const motionMountObserver = new MutationObserver(mutations => {
        window.cancelAnimationFrame(mutationFrame);
        mutationFrame = window.requestAnimationFrame(() => mutations.forEach(mutation => mutation.addedNodes.forEach(node => {
          if (node.nodeType === 1) prepareMotion(node);
        })));
      });
      motionMountObserver.observe(reactRoot, { childList:true, subtree:true });
    }
    prepareMotion(document.querySelector('.site-footer') || document.body);

    if (window.matchMedia('(pointer:fine)').matches) {
      document.addEventListener('pointermove', event => {
        const surface = event.target.closest?.('.motion-depth.motion-in');
        if (!surface) return;
        const rect = surface.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width;
        const y = (event.clientY - rect.top) / rect.height;
        surface.style.setProperty('--glow-x', `${x * 100}%`);
        surface.style.setProperty('--glow-y', `${y * 100}%`);
        surface.style.setProperty('--tilt-x', `${(0.5 - y) * 3.2}deg`);
        surface.style.setProperty('--tilt-y', `${(x - 0.5) * 3.2}deg`);
      }, { passive:true });
      document.addEventListener('pointerout', event => {
        const surface = event.target.closest?.('.motion-depth');
        if (!surface || surface.contains(event.relatedTarget)) return;
        surface.style.removeProperty('--tilt-x');
        surface.style.removeProperty('--tilt-y');
      }, { passive:true });
    }

    document.addEventListener('pointerdown', event => {
      const target = event.target.closest?.('.button,.site-nav a,.mobile-tabbar a');
      if (!target) return;
      const rect = target.getBoundingClientRect();
      const ripple = document.createElement('i');
      ripple.className = 'motion-ripple';
      ripple.style.left = `${event.clientX - rect.left}px`;
      ripple.style.top = `${event.clientY - rect.top}px`;
      ripple.setAttribute('aria-hidden', 'true');
      target.appendChild(ripple);
      ripple.addEventListener('animationend', () => ripple.remove(), { once:true });
    }, { passive:true });
  };

  setupNextGenMotion();

  const setupUniversalTextEntrance = () => {
    if (reducedMotion || !('IntersectionObserver' in window)) return;
    document.documentElement.classList.add('universal-text-motion');
    const selector = 'main h1, main h2, main h3, main h4, main h5, main h6, main p, main li, main blockquote, main .overline, main cite, main address, main figcaption, main .home-story-verse span, .site-footer h2, .site-footer p, .site-footer address, .site-footer .home-footer-copyright';
    const prepared = new WeakSet();
    const textObserver = new IntersectionObserver(entries => entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('universal-text-in');
      textObserver.unobserve(entry.target);
    }), { threshold:.08, rootMargin:'0px 0px -3% 0px' });
    const prepare = root => {
      const elements = [];
      if (root.nodeType === 1 && root.matches?.(selector)) elements.push(root);
      root.querySelectorAll?.(selector).forEach(element => elements.push(element));
      elements.forEach((element, index) => {
        if (prepared.has(element) || element.closest('.public-student-grid,.college-student-list,.ranking-list,.participant-results-scroll,.program-admin-list,.review-admin-list,.admin-dashboard,.schedule-grid,.musabaqa-plan-row')) return;
        prepared.add(element);
        element.classList.add('universal-text-enter');
        element.style.setProperty('--universal-text-delay', `${Math.min(index % 5, 4) * 55}ms`);
        textObserver.observe(element);
      });
    };
    prepare(document.body);
    const root = document.getElementById('react-root');
    if (!root) return;
    let frame = 0;
    const mountObserver = new MutationObserver(mutations => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => mutations.forEach(mutation => mutation.addedNodes.forEach(node => {
        if (node.nodeType === 1) prepare(node);
      })));
    });
    mountObserver.observe(root, { childList:true, subtree:true });
  };

  setupUniversalTextEntrance();

  document.querySelectorAll('[data-score]').forEach(el => {
    const target = Number(el.dataset.score);
    let start;
    const animate = time => {
      start ??= time;
      const progress = Math.min((time - start) / 1200, 1);
      el.textContent = String(Math.round(target * (1 - Math.pow(1 - progress, 3))));
      if (progress < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  });

  const setClock = () => document.querySelectorAll('[data-time]').forEach(el => {
    el.textContent = new Intl.DateTimeFormat('en-GB', { hour:'2-digit', minute:'2-digit', hour12:false }).format(new Date());
  });
  setClock(); window.setInterval(setClock, 30000);

  const setUpdated = () => document.querySelectorAll('[data-clock]').forEach(el => {
    el.textContent = new Intl.DateTimeFormat('en-GB', { hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false }).format(new Date());
  });
  setUpdated(); window.setInterval(setUpdated, 15000);

  const search = document.querySelector('.participant-search input');
  search?.addEventListener('input', () => {
    const query = search.value.trim().toLowerCase();
    document.querySelectorAll('.participant-row').forEach(row => row.hidden = !row.dataset.name.includes(query));
  });

  const speakerCard = document.querySelector('.speaker-card');
  document.querySelectorAll('.participant-row').forEach(row => row.addEventListener('click', () => {
    document.querySelectorAll('.participant-row').forEach(item => item.classList.remove('active'));
    row.classList.add('active');
    const name = row.querySelector('strong')?.textContent;
    const details = row.querySelector('small')?.textContent;
    const time = row.querySelector('time')?.textContent;
    if (!speakerCard || !name || !details || !time) return;
    speakerCard.querySelector('h2').textContent = name;
    speakerCard.querySelector('footer strong').textContent = time;
    speakerCard.querySelector('footer span').textContent = details;
  }));

  const tabs = [...document.querySelectorAll('[data-session]')];
  const columns = [...document.querySelectorAll('[data-session-column]')];
  const choose = session => {
    tabs.forEach(tab => tab.classList.toggle('active', tab.dataset.session === session));
    columns.forEach(column => column.classList.toggle('mobile-active', column.dataset.sessionColumn === session));
  };
  tabs.forEach(tab => tab.addEventListener('click', () => choose(tab.dataset.session)));
  if (tabs.length) choose('morning');
})();
