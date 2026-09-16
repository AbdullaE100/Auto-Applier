/**
 * JobFlow AI - Extension Popup Logic
 */

const API_BASE = 'http://localhost:3000';

document.addEventListener('DOMContentLoaded', async () => {
  const badge = document.getElementById('connection-badge');
  const userName = document.getElementById('user-name');
  const userEmail = document.getElementById('user-email');
  const avatar = document.getElementById('avatar-initials');
  const planBadge = document.getElementById('plan-badge');
  const creditsRem = document.getElementById('credits-remaining');
  const creditsTot = document.getElementById('credits-total');
  const meterFill = document.getElementById('meter-fill');

  try {
    const [profileRes, creditsRes] = await Promise.all([
      fetch(`${API_BASE}/api/profile`),
      fetch(`${API_BASE}/api/credits`)
    ]);

    if (profileRes.ok && creditsRes.ok) {
      const profile = await profileRes.json();
      const credits = await creditsRes.json();

      badge.textContent = 'Connected';
      badge.className = 'badge badge-success';

      const fName = profile.firstName || 'Candidate';
      const lName = profile.lastName || '';
      userName.textContent = `${fName} ${lName}`.trim();
      userEmail.textContent = profile.email || 'No email set';

      avatar.textContent = (fName[0] || 'J') + (lName[0] || 'F');

      planBadge.textContent = `${credits.plan.toUpperCase()} PLAN`;
      creditsRem.textContent = `${credits.remaining} left`;
      creditsTot.textContent = `of ${credits.total} / mo`;

      const pct = Math.round(((credits.total - credits.remaining) / credits.total) * 100);
      meterFill.style.width = `${Math.min(100, Math.max(5, pct))}%`;
    } else {
      throw new Error('API responded with error');
    }
  } catch {
    badge.textContent = 'Offline';
    badge.className = 'badge badge-error';
    userName.textContent = 'Dashboard Offline';
    userEmail.textContent = 'Start JobFlow server at :3000';
    avatar.textContent = '!';
    creditsRem.textContent = '0 left';
  }
});
