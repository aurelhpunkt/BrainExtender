let calendarInstance = null;
let loadChartInstance = null;
let calendarDataLoaded = false;

async function loadCalendar() {
  if (!calendarDataLoaded) {
    initCalendarUI();
    calendarDataLoaded = true;
  }
  await fetchCalendarData();
  await refreshCalendarAIStatus();
}

function initCalendarUI() {
  // Initialize FullCalendar
  const calendarEl = document.getElementById('smart-calendar');
  if (calendarEl && typeof FullCalendar !== 'undefined') {
    calendarInstance = new FullCalendar.Calendar(calendarEl, {
      initialView: 'timeGridWeek',
      headerToolbar: {
        left: 'prev,next today',
        center: 'title',
        right: 'dayGridMonth,timeGridWeek,timeGridDay'
      },
      locale: 'de',
      nowIndicator: true,
      events: [] // Will be populated dynamically
    });
    calendarInstance.render();
  }

  // Initialize Chart.js for Load Curve
  const ctx = document.getElementById('calendarLoadChart');
  if (ctx && typeof Chart !== 'undefined') {
    loadChartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels: ['Tag 1', 'Tag 2', 'Tag 3', 'Tag 4', 'Tag 5', 'Tag 6', 'Tag 7'],
        datasets: [{
          label: 'Stress / Load Curve',
          data: [0, 0, 0, 0, 0, 0, 0],
          borderColor: 'rgb(255, 99, 132)',
          backgroundColor: 'rgba(255, 99, 132, 0.2)',
          fill: true,
          tension: 0.4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          y: { beginAtZero: true, max: 100 }
        }
      }
    });
  }

  // Bind Optimize Button
  const btnOptimize = document.getElementById('btn-optimize-calendar');
  if (btnOptimize) {
    btnOptimize.addEventListener('click', () => {
      btnOptimize.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Analysiere...';
      refreshCalendarAIStatus().finally(() => {
        btnOptimize.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> KI-Synergie Optimierung';
      });
    });
  }
}

async function fetchCalendarData() {
  if (!calendarInstance) return;
  
  try {
    const resAppt = await fetch('/api/appointments');
    const appointments = resAppt.ok ? await resAppt.json() : [];
    
    // Transform appointments for FullCalendar
    const events = appointments.map(appt => {
      let color = '#3788d8';
      if (appt.category === 'Sport' || appt.category === 'Regeneration') color = '#28a745';
      if (appt.category === 'Date') color = '#6f42c1';
      if (appt.category === 'Arbeit' && appt.energyLevel > 3) color = '#dc3545';
      
      const startDate = new Date(appt.date);
      const endDate = new Date(startDate.getTime() + (appt.duration || 60) * 60000);
      
      return {
        id: appt.id,
        title: appt.title + (appt.geo_location ? ` (${appt.geo_location})` : ''),
        start: startDate,
        end: endDate,
        backgroundColor: color,
        borderColor: color
      };
    });
    
    calendarInstance.removeAllEvents();
    calendarInstance.addEventSource(events);
    
  } catch (err) {
    console.error("Fehler beim Laden der Kalenderdaten:", err);
  }
}

async function refreshCalendarAIStatus() {
  const trafficLight = document.getElementById('calendar-traffic-light');
  const trafficText = document.getElementById('calendar-traffic-text');
  const suggestionsList = document.getElementById('calendar-ai-suggestions');
  
  if (trafficLight) trafficLight.style.opacity = '0.5';
  
  try {
    const res = await fetch('/api/calendar/status', { method: 'POST' });
    if (!res.ok) throw new Error("API Fehler");
    const data = await res.json();
    
    // Update Traffic Light
    if (trafficLight && trafficText) {
      trafficLight.style.opacity = '1';
      trafficLight.className = 'traffic-light'; // reset
      
      if (data.status === 'green') {
        trafficLight.classList.add('status-green');
        trafficLight.style.background = 'rgba(40, 167, 69, 0.2)';
        trafficLight.style.color = '#28a745';
        trafficText.textContent = "Woche ist ausgewogen";
      } else if (data.status === 'yellow') {
        trafficLight.classList.add('status-yellow');
        trafficLight.style.background = 'rgba(255, 193, 7, 0.2)';
        trafficLight.style.color = '#ffc107';
        trafficText.textContent = "Leichte Unterdeckung/Konflikte";
      } else {
        trafficLight.classList.add('status-red');
        trafficLight.style.background = 'rgba(220, 53, 69, 0.2)';
        trafficLight.style.color = '#dc3545';
        trafficText.textContent = "Kritische Auslastung!";
      }
    }
    
    // Update Chart
    if (loadChartInstance && data.loadCurve && Array.isArray(data.loadCurve)) {
      // Create labels for the next 7 days
      const labels = [];
      for(let i=0; i<7; i++) {
        const d = new Date();
        d.setDate(d.getDate() + i);
        labels.push(d.toLocaleDateString('de-DE', {weekday: 'short'}));
      }
      loadChartInstance.data.labels = labels;
      
      // We expect up to 7 values in the array
      loadChartInstance.data.datasets[0].data = data.loadCurve;
      
      // Change color based on status
      let chartColor = 'rgb(40, 167, 69)';
      let bgColor = 'rgba(40, 167, 69, 0.2)';
      if (data.status === 'yellow') {
        chartColor = 'rgb(255, 193, 7)';
        bgColor = 'rgba(255, 193, 7, 0.2)';
      } else if (data.status === 'red') {
        chartColor = 'rgb(220, 53, 69)';
        bgColor = 'rgba(220, 53, 69, 0.2)';
      }
      
      loadChartInstance.data.datasets[0].borderColor = chartColor;
      loadChartInstance.data.datasets[0].backgroundColor = bgColor;
      
      loadChartInstance.update();
    }
    
    // Update Suggestions
    if (suggestionsList) {
      suggestionsList.innerHTML = '';
      if (data.suggestions && data.suggestions.length > 0) {
        data.suggestions.forEach(suggestion => {
          const li = document.createElement('li');
          li.className = 'insight-item';
          li.innerHTML = `<i class="fa-solid fa-arrow-right-arrow-left"></i> ${suggestion}`;
          suggestionsList.appendChild(li);
        });
      } else {
        suggestionsList.innerHTML = '<li class="insight-item"><i class="fa-solid fa-check"></i> Alles sieht gut aus! Keine Verschiebungen nötig.</li>';
      }
    }
    
  } catch (err) {
    console.error("Fehler beim KI Status Fetch:", err);
    if (trafficLight) {
      trafficLight.style.opacity = '1';
      trafficText.textContent = "Fehler bei der Analyse";
    }
  }
}
