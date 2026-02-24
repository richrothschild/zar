import { useState } from 'react';

type HelpTab = 'start' | 'rules' | 'tips';

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
          <button className={`help-tab${tab === 'start' ? ' help-tab--active' : ''}`} onClick={() => setTab('start')}>Getting Started</button>
          <button className={`help-tab${tab === 'rules' ? ' help-tab--active' : ''}`} onClick={() => setTab('rules')}>Rules</button>
          <button className={`help-tab${tab === 'tips'  ? ' help-tab--active' : ''}`} onClick={() => setTab('tips')}>Tips</button>
        </div>

        <div className="help-modal__content">
          {tab === 'start' && <GettingStarted />}
          {tab === 'rules' && <Rules />}
          {tab === 'tips'  && <Tips />}
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

      <h3>2. Create or join a room</h3>
      <p><strong>Create Room</strong> — You become the host. Set the target score (25–200 points) and share the 5-letter room code with your friends.</p>
      <p><strong>Join Room</strong> — Enter the room code your host shared and click <strong>Join Room</strong>.</p>

      <h3>3. Wait in the lobby</h3>
      <p>The lobby shows everyone who has joined. You need at least 2 players. The host can start the game at any time.</p>

      <h3>4. Add bots (optional)</h3>
      <p>If there are fewer than 4 players, the host will be asked whether to fill the remaining seats with bot players. Bots play automatically.</p>

      <h3>5. Start playing</h3>
      <p>The host clicks <strong>Start Game</strong>. Cards are dealt and play begins with the host.</p>

      <h3>Reconnecting</h3>
      <p>If you lose your connection mid-game, rejoin with the same name and room code within <strong>90 seconds</strong> to get your hand back.</p>

      <h3>Spectating</h3>
      <p>Join a room that is already in progress to watch as a spectator. You can see the board but cannot play cards.</p>
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
      <p>At any time, if the top discard card exactly matches a card in your hand (same color AND same symbol or command), you can immediately play it — even when it's not your turn. The player whose turn it was draws 1 penalty card. Your turn then comes next.</p>

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
      <p>Matching is available at any time — not just right after a card is played. Keep an eye on the top discard card and be ready to slam down a match the moment it appears.</p>

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
      <p>The sidebar shows how many cards each player holds. Focus your Wasps and Frogs on players with few cards to slow them down.</p>

      <h3>Managing the draw pile</h3>
      <p>When the draw pile drops below 10 cards, the discard pile is added back to the bottom (without shuffling). Plan accordingly — the cards that were played recently will come back around.</p>

      <h3>Declare wisely</h3>
      <p>After playing a Dragon or Peacock, pick a symbol or color you hold in your hand. That way you'll be able to play next turn even if someone else matches first.</p>
    </div>
  );
}
