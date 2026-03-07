import { useState } from 'react';

type HelpTab = 'start' | 'rules' | 'tips' | 'issues';

interface HelpModalProps {
  initialTab?: HelpTab;
  onClose: () => void;
}

export default function HelpModal({ initialTab = 'start', onClose }: HelpModalProps) {
  const [tab, setTab] = useState<HelpTab>(initialTab);

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal help-modal">
        <button className="help-modal__close" onClick={onClose} aria-label="Close">✕</button>

        <div className="help-modal__tabs">
          <button className={`help-tab${tab === 'start'  ? ' help-tab--active' : ''}`} onClick={() => setTab('start')}>Get Started</button>
          <button className={`help-tab${tab === 'rules'  ? ' help-tab--active' : ''}`} onClick={() => setTab('rules')}>Rules</button>
          <button className={`help-tab${tab === 'tips'   ? ' help-tab--active' : ''}`} onClick={() => setTab('tips')}>Tips</button>
          <button className={`help-tab${tab === 'issues' ? ' help-tab--active' : ''}`} onClick={() => setTab('issues')}>Issues</button>
        </div>

        <div className="help-modal__content">
          {tab === 'start'  && <GettingStarted />}
          {tab === 'rules'  && <Rules />}
          {tab === 'tips'   && <Tips />}
          {tab === 'issues' && <Issues />}
        </div>
      </div>
    </div>
  );
}

function GettingStarted() {
  return (
    <div className="help-section">
      <h2>Getting Started</h2>

      <h3>1. Enter your name</h3>
      <p>Type your name on the home screen and click <strong>Continue</strong>.</p>

      <h3>2. Join or host a game</h3>
      <p><strong>Via invite link</strong> — If the host shared a link, just open it, enter your name, and you're in instantly.</p>
      <p><strong>No link?</strong> — After entering your name, the game checks for open rooms automatically. If one exists you'll see: "Join [Host]'s game?" — click <strong>Yes, join!</strong> to enter. If no rooms are open, you'll be asked to host; click <strong>Yes, I'll host</strong> to create a room.</p>

      <h3>3. Wait in the lobby</h3>
      <p>The lobby shows everyone who has joined. You need at least 2 players. The host clicks <strong>Start Game</strong> when everyone is ready. As host, share the <strong>📋 Copy invite link</strong> button so friends can join with one click.</p>

      <h3>4. Add bots (optional)</h3>
      <p>If there are fewer than 4 players, the host will be asked whether to fill seats with bot players. Bots play automatically but wait 15 seconds per turn so you have time to react and match cards.</p>

      <h3>5. Start playing</h3>
      <p>Cards are dealt and play begins clockwise from the host. Your cards appear at the bottom — tap one to play it.</p>

      <h3>Reconnecting</h3>
      <p>If you lose connection mid-game, reopen the same invite link (or the same URL) with <strong>your exact same name</strong> within <strong>90 seconds</strong> to reclaim your hand.</p>

      <h3>Spectating</h3>
      <p>Join a room that is already in progress to watch as a spectator. You can see the board but cannot play cards.</p>

      <h3>Voice Chat Setup</h3>
      <p>Click the <strong>🎙️ Voice</strong> button during a game to talk with other players. Your browser will ask for microphone permission — click <strong>Allow</strong>.</p>
      <p>If the mic is blocked, fix it by browser:</p>
      <ul>
        <li><strong>Chrome / Edge</strong>: Click the 🔒 icon in the address bar → Microphone → Allow → reload the page.</li>
        <li><strong>Firefox</strong>: Click 🔒 → Permissions → Microphone → Allow.</li>
        <li><strong>Safari</strong>: Safari menu → Settings for This Website → Microphone → Allow.</li>
      </ul>
      <p>If it's still blocked, check your OS:</p>
      <ul>
        <li><strong>Windows</strong>: Settings → Privacy &amp; Security → Microphone → turn on for your browser.</li>
        <li><strong>macOS</strong>: System Settings → Privacy &amp; Security → Microphone → allow the browser.</li>
      </ul>
    </div>
  );
}

function Rules() {
  return (
    <div className="help-section">
      <h2>Rules</h2>

      <h3>Goal</h3>
      <p>Be the first player to play all your cards each round. Players left holding cards score points equal to those cards' values. The player with the <strong>lowest score</strong> when anyone hits the target wins.</p>

      <h3>The Deck (62 cards)</h3>
      <table className="help-table">
        <thead><tr><th>Type</th><th>Cards</th><th>Points</th></tr></thead>
        <tbody>
          <tr><td>Basic</td><td>6 symbols × 3 colors × 2 copies = 36</td><td>1 each</td></tr>
          <tr><td>Wasp (draw 2)</td><td>3 colors × 2 copies = 6</td><td>3 each</td></tr>
          <tr><td>Frog (skip)</td><td>3 colors × 2 copies = 6</td><td>2 each</td></tr>
          <tr><td>Crab (reverse)</td><td>3 colors × 2 copies = 6</td><td>2 each</td></tr>
          <tr><td>Dragon</td><td>2 pairs = 4</td><td>5 each</td></tr>
          <tr><td>Peacock</td><td>2 pairs = 4</td><td>5 each</td></tr>
        </tbody>
      </table>
      <p className="help-note">Symbols: 🌌 Galaxy · 🌙 Moon · ☁️ Cloud · ☀️ Sun · ⭐ Star · ⚡ Lightning &nbsp;|&nbsp; Colors: Yellow · Blue · Red</p>

      <h3>Playing a card</h3>
      <p>On your turn, play a card from your hand that matches the top discard pile card by <strong>color</strong>, <strong>symbol</strong>, or <strong>command type</strong>. If you can't (or don't want to) play, draw one card. You may then play the drawn card or pass.</p>

      <h3>Command cards</h3>
      <ul>
        <li><strong>Wasp 🐝</strong> — The next player must draw 2 cards instead of playing. Wasps can be stacked: play your own Wasp to pass the penalty along (+2 per Wasp stacked).</li>
        <li><strong>Frog 🐸</strong> — Skip the next player's turn.</li>
        <li><strong>Crab 🦀</strong> — Reverse the direction of play.</li>
      </ul>
      <p>Doubles amplify the effect: double Wasp = draw 4, double Frog = skip 2 players, double Crab = direction unchanged.</p>

      <h3>Power cards</h3>
      <ul>
        <li><strong>Dragon 🐉</strong> — Can be played on any non-Peacock card. After playing, declare a symbol. The next player must play that symbol OR the current active color.</li>
        <li><strong>Peacock 🦚</strong> — Can be played on any non-Dragon card. After playing, declare a color. The next player must play that color OR the current active symbol/command.</li>
      </ul>

      <h3>Out-of-turn matching</h3>
      <p>If the top discard card exactly matches a card in your hand (same color AND same symbol or command), you can play it at any time — even when it's not your turn. The match window stays open until the next card is played, so there's no rush. The player whose turn it was draws 1 penalty card, and your turn comes next.</p>

      <h3>Doubles</h3>
      <p>Play two identical cards (same color + same symbol) together as one move for an amplified effect. You cannot go out on a double — you must have at least 3 cards to play a double.</p>

      <h3>ZAR!</h3>
      <p>When you play down to 1 card, you must say <strong>"ZAR!"</strong> by clicking the button. If another player catches you before you announce it, they can challenge you and you draw 1 penalty card.</p>

      <h3>Round end</h3>
      <p>The round ends when one player empties their hand. Everyone else adds the point value of their remaining cards to their score. Rounds continue until a player's cumulative score reaches or exceeds the target — that player loses, and whoever has the lowest score wins.</p>
    </div>
  );
}

function Tips() {
  return (
    <div className="help-section">
      <h2>Tips</h2>

      <h3>Stay alert for matches</h3>
      <p>The match window stays open until the next card is played — there is no time limit. As long as the top discard card hasn't changed, you can play an exact match at any point during other players' turns.</p>

      <h3>Stack Wasps</h3>
      <p>If someone plays a Wasp and you have one too, play yours to pass the penalty on. Each additional Wasp adds 2 more draws, so a chain of Wasps can be devastating for whoever finally absorbs it.</p>

      <h3>Save power cards</h3>
      <p>Dragon and Peacock cards can be played on almost anything. Hold them until you're stuck with no playable cards — they'll get you out of trouble and let you dictate the next play.</p>

      <h3>Use Crab to stall</h3>
      <p>Reversing direction shifts the turn away from a player who just had a good play and puts pressure back on someone else. Useful when the player to your left is about to go out.</p>

      <h3>Double when you can</h3>
      <p>Doubles burn two cards in one move (and have stronger effects). Look for pairs in your hand and use them before the top card changes.</p>

      <h3>Challenge early</h3>
      <p>If a player drops to 1 card and doesn't say ZAR!, challenge them immediately — before they play their last card. Once the round is over it's too late.</p>

      <h3>Count cards</h3>
      <p>The player bar shows how many cards each player holds. Focus your Wasps and Frogs on players with few cards to slow them down.</p>

      <h3>Managing the draw pile</h3>
      <p>When the draw pile drops below 10 cards, the discard pile is added back to the bottom (without shuffling). Plan accordingly — the cards that were played recently will come back around.</p>

      <h3>Declare wisely</h3>
      <p>After playing a Dragon or Peacock, pick a symbol or color you hold in your hand. That way you'll be able to play next turn even if someone else matches first.</p>
    </div>
  );
}

function Issues() {
  return (
    <div className="help-section">
      <h2>Troubleshooting</h2>
      <p className="help-note">Top 20 issues players run into — and how to fix them.</p>

      <h3>1. Microphone is blocked by the browser</h3>
      <p>Click the <strong>🔒 lock icon</strong> in the address bar → set Microphone to <strong>Allow</strong> → reload the page. On Firefox: 🔒 → Permissions → Microphone → Allow. On Safari: Safari menu → Settings for This Website → Microphone → Allow.</p>

      <h3>2. No microphone detected</h3>
      <p>No mic hardware was found on this device. Plug in a headset or check your OS sound settings. On Windows: Settings → Sound → Input. On macOS: System Settings → Sound → Input.</p>

      <h3>3. Mic is in use by another app</h3>
      <p>Another program (Zoom, Teams, Discord, etc.) is holding the microphone. Close it, then click <strong>🎙️ Voice</strong> again.</p>

      <h3>4. Can't hear other players in voice chat</h3>
      <p>Check your speaker/headphone volume. Try clicking <strong>✕</strong> to leave the voice channel and then rejoining with <strong>🎙️ Voice</strong>. Both players must be in the same voice channel — the button shows the count when connected.</p>

      <h3>5. Page is blank or won't load</h3>
      <p>Do a hard refresh: <strong>Ctrl + Shift + R</strong> on Windows/Linux, <strong>Cmd + Shift + R</strong> on Mac. If it still fails, try a different browser or clear the cache.</p>

      <h3>6. Disconnected mid-game</h3>
      <p>Reopen the same invite link (or game URL) and enter your <strong>exact same name</strong>. You have <strong>90 seconds</strong> to reconnect and reclaim your hand. After that your seat is removed.</p>

      <h3>7. Invite link doesn't work ("Room not found")</h3>
      <p>The room ended or the host closed their tab. Ask the host to create a new room and share a fresh invite link.</p>

      <h3>8. "Room is full"</h3>
      <p>Rooms hold up to 9 players. Wait for a spot to open, or ask the host to start a second room.</p>

      <h3>9. No game shows up to join</h3>
      <p>No host has created a room yet. Click <strong>Continue</strong> on the home screen, then <strong>Yes, I'll host</strong>. Share your invite link with the group so others can join.</p>

      <h3>10. "Name already taken in this room"</h3>
      <p>Another player in the room is using that name. Choose a different name and try again.</p>

      <h3>11. Joined as a spectator instead of a player</h3>
      <p>You arrived after the game started. Spectators can watch but not play. Ask the host to start a new round — or join a fresh game next time before the host clicks Start.</p>

      <h3>12. It's not my turn and I can't play</h3>
      <p>Wait for the <strong>"Your turn!"</strong> banner. You can still play an out-of-turn match if the top discard card exactly matches a card in your hand (same color + same symbol or command).</p>

      <h3>13. My card won't play — it's highlighted but rejected</h3>
      <p>The card must match the top discard by <strong>color</strong>, <strong>symbol</strong>, or <strong>command type</strong>. If the 🐝 wasp banner is showing, <strong>only another Wasp</strong> can be played until the penalty is drawn.</p>

      <h3>14. There's a Wasp penalty and I'm stuck</h3>
      <p>Tap <strong>Draw</strong> to take the penalty cards. After drawing you can still play a card from your hand or pass — the Wasp draw does not end your turn.</p>

      <h3>15. Can't go out — won't let me play my last double</h3>
      <p>You cannot win the round on a double play. With exactly 2 cards you must play them one at a time. Play the first card to go out with 1 card, say ZAR!, then play the last card next turn.</p>

      <h3>16. Forgot to say ZAR! and got challenged</h3>
      <p>The instant you play down to 1 card, tap <strong>Say ZAR!</strong> before anyone else acts. Opponents can challenge you at any moment until you do, forcing you to draw 1 penalty card.</p>

      <h3>17. I missed my chance to match</h3>
      <p>The out-of-turn match window stays open until the <strong>next card is played</strong> — there is no time limit. As long as the top discard card hasn't changed, you can still tap it to match. Keep an eye on the discard pile and tap before anyone else plays.</p>

      <h3>18. A Dragon or Peacock modal appeared and the game froze</h3>
      <p>You played a Dragon or Peacock — the game is waiting for you to <strong>choose a symbol or color</strong>. Select one from the popup and play will continue immediately.</p>

      <h3>19. Bot turns are very slow</h3>
      <p>Bots intentionally wait <strong>15 seconds</strong> before playing. This gives human players time to play out-of-turn matches. It's by design, not a bug.</p>

      <h3>20. The draw pile ran out of cards</h3>
      <p>When the draw pile drops below 10 cards, the discard pile (minus the current top card) is automatically added back to the bottom. The game will never truly run out of cards.</p>
    </div>
  );
}
