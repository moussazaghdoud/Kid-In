/* ============================================
   Seeded Random Number Generator
   Uses Mulberry32 algorithm for deterministic
   random numbers from a seed value.
   ============================================ */

class SeededRandom {
    constructor(seed) {
        this._state = seed | 0;
    }

    // Returns a float in [0, 1)
    next() {
        let t = (this._state += 0x6D2B79F5);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    // Returns an integer in [min, max]
    randInt(min, max) {
        return Math.floor(this.next() * (max - min + 1)) + min;
    }

    // Fisher-Yates shuffle using seeded random
    shuffle(arr) {
        const a = [...arr];
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(this.next() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }
}
