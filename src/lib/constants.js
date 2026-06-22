// ----------------------------- Constants ------------------------------
// Framework-agnostic constants and small identity helpers, ported from the
// original single-file app so the React layer can compose them freely.

export const MAX_PEERS = 6; // including host
export const MAX_NOMINATIONS = 3; // movies per person
export const MAX_NAME_LEN = 24; // display-name character cap

// Embedding vector dimensionality (must match scripts/generate_embeddings.py).
export const EMBED_DIM = 3072;

// ---- Fun movie-themed room codes ----------------------------------------
// Room codes read like a whimsical little movie tagline: <adjective>-<noun>,
// e.g. "moonlit-popcorn". With 80 adjectives x 80 nouns there are 6,400
// possible combinations of delightfully silly, cinematic phrases.
export const ROOM_ADJECTIVES = [
  'epic', 'silent', 'classic', 'noir', 'technicolor', 'blockbuster', 'indie',
  'animated', 'cult', 'golden', 'dramatic', 'comic', 'action', 'vintage',
  'surreal', 'gritty', 'dreamy', 'cosmic', 'retro', 'starry', 'matinee',
  'primetime', 'widescreen', 'cinematic', 'iconic', 'legendary', 'spooky',
  'romantic', 'thrilling', 'suspenseful', 'musical', 'western', 'futuristic', 'heroic',
  'mysterious', 'whimsical', 'dazzling', 'breezy', 'campy', 'glossy', 'moody',
  'snappy', 'sparkly', 'twisty', 'velvet', 'silver', 'midnight', 'sunny',
  'cozy', 'electric', 'bumbling', 'giggly', 'fizzy', 'wobbly', 'snuggly',
  'bouncy', 'jolly', 'dapper', 'fuzzy', 'twinkly', 'sneaky', 'cuddly',
  'zany', 'goofy', 'bubbly', 'plucky', 'wiggly', 'spiffy', 'nifty',
  'quirky', 'peppy', 'jaunty', 'frolicsome', 'moonlit', 'enchanted',
  'marvelous', 'flickering', 'gilded', 'rascally', 'swashbuckling', 'chipper',
];
export const ROOM_NOUNS = [
  'popcorn', 'reel', 'director', 'marquee', 'trailer', 'cameo', 'sequel',
  'oscar', 'screenplay', 'soundtrack', 'premiere', 'credits', 'projector',
  'screening', 'montage', 'closeup', 'cliffhanger', 'blooper', 'matinee',
  'usher', 'ticket', 'reboot', 'spotlight', 'curtain', 'backlot', 'studio',
  'cinema', 'theater', 'auteur', 'gaffer', 'stuntman', 'sidekick', 'villain',
  'protagonist', 'closeups', 'storyboard', 'flashback', 'epilogue', 'prologue',
  'intermission', 'lobbycard', 'boxoffice', 'nickelodeon', 'newsreel', 'overture',
  'encore', 'clapboard', 'dolly', 'boommic', 'genre', 'popcornpot', 'snackbar',
  'jujube', 'gumdrop', 'sodapop', 'nachos', 'velvetrope', 'doubledecker',
  'understudy', 'matineemouse', 'ushergnome', 'reeldragon', 'plotbunny',
  'twistending', 'cameokitten', 'dreamsequence', 'creditcookie', 'easteregg',
  'megaphone', 'spotlightowl', 'popcornpenguin', 'curtaincall', 'standin',
  'wranglergoose', 'bestboy', 'foleyfox', 'matineemoth', 'redcarpet',
  'silverscreen', 'doublefeature', 'jumpscare', 'plottwist',
];

// Pick a whimsical, movie-themed room code: adjective-noun.
export function randomRoomId() {
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  return `${pick(ROOM_ADJECTIVES)}-${pick(ROOM_NOUNS)}`;
}

// Normalize a room code from a URL / QR / saved value into the canonical
// form: lowercase, only [a-z0-9-], no leading/trailing or doubled hyphens.
export function normalizeRoomId(raw) {
  return String(raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// 100 fun/cute nicknames used as default placeholders for participants.
export const FUN_NAMES = [
  'Popcorn Pixie', 'Captain Cuddles', 'Sir Snacks-a-Lot', 'Bubbly Otter', 'Disco Penguin',
  'Marshmallow Mage', 'Cozy Raccoon', 'Velvet Llama', 'Pixel Pony', 'Glitter Goblin',
  'Mango Tango', 'Sleepy Koala', 'Turbo Turtle', 'Waffle Wizard', 'Nacho Average',
  'Pickle Rickle', 'Snuggle Bug', 'Banana Bandit', 'Cosmic Corgi', 'Jelly Bean Jr.',
  'Wobbly Walrus', 'Sneaky Sloth', 'Fuzzy Peach', 'Doodle Dragon', 'Pepper Pop',
  'Biscuit Boss', 'Twinkle Toes', 'Noodle Knight', 'Sassy Squid', 'Maple Munchkin',
  'Bouncy Bean', 'Captain Comfy', 'Giggly Gecko', 'Mochi Monster', 'Sprinkle Sprite',
  'Cuddly Cactus', 'Zippy Zebra', 'Honey Badger Jr.', 'Cocoa Comet', 'Fluffy Phoenix',
  'Waffles McGee', 'Gummy Bear King', 'Pixel Panda', 'Salty Pretzel', 'Dizzy Dolphin',
  'Lil Sasquatch', 'Mellow Marshmallow', 'Funky Ferret', 'Bubble Tea Boss', 'Star Muffin',
  'Quokka Quokka', 'Dapper Duckling', 'Choco Chip', 'Rambling Radish', 'Mighty Meatball',
  'Sunny Sloth', 'Glimmer Goose', 'Pancake Pirate', 'Tiny Tornado', 'Velcro Vulture',
  'Cosmic Cupcake', 'Jolly Jellyfish', 'Pickle Pixel', 'Wiggly Wombat', 'Toasty Toad',
  'Snappy Snail', 'Lava Lamp Larry', 'Bramble Bunny', 'Cheeky Chinchilla', 'Mint Condition',
  'Razzle Dazzle', 'Puddle Jumper', 'Fizzy Fox', 'Grumpy Gnome', 'Sundae Funday',
  'Whisker Wizard', 'Boba Bandit', 'Pixel Possum', 'Crispy Comet', 'Loopy Lemur',
  'Sir Wigglesworth', 'Cuddlefish', 'Taco Tuesday', 'Plushie Pilot', 'Nimble Newt',
  'Glow Worm', 'Bubblegum Baron', 'Sleepy Sundae', 'Captain Crumbs', 'Twirly Whirly',
  'Mango Marauder', 'Frosty Ferret', 'Doodlebug', 'Spicy Samosa', 'Mellow Moose',
  'Pocket Rocket', 'Wandering Waffle', 'Cinnamon Swirl', 'Lucky Ladybug', 'Galaxy Gummy',
];

// Pick a nickname not already used by other peers (falls back to a numbered one).
export function pickNickname(takenNames) {
  const taken = new Set(takenNames);
  const pool = FUN_NAMES.filter((n) => !taken.has(n));
  if (pool.length) return pool[Math.floor(Math.random() * pool.length)];
  return `Guest ${Math.floor(Math.random() * 1000)}`;
}

// Sanitize a user-submitted display name.
export function cleanName(raw) {
  return String(raw || '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LEN);
}
