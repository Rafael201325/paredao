const { createApp } = Vue;

createApp({
  data() {
    return {
      weekTitle: 'Carregando...',
      candidates: [],
      message: '',
      messageColor: '#047857',
      loading: false,
      hasOpenWeek: false,
      currentWeekId: null,
      participants: [
        { id: 1, name: 'Rafael' },
        { id: 2, name: 'Mike' },
        { id: 3, name: 'Laura' },
        { id: 4, name: 'Belmiro' },
        { id: 5, name: 'Luana P.O' },
        { id: 6, name: 'Luana Designer' },
        { id: 7, name: 'Vinicius' },
      ],
      reactions: [
        { id: 'heart', emoji: '❤️', label: 'Coracao', short: 'Coracao' },
        { id: 'snake', emoji: '🐍', label: 'Cobra', short: 'Cobra' },
        { id: 'vomit', emoji: '🤮', label: 'Vomito', short: 'Vomito' },
        { id: 'plant', emoji: '🌱', label: 'Planta', short: 'Planta' },
        { id: 'target', emoji: '🎯', label: 'Alvo', short: 'Alvo' },
        { id: 'liar', emoji: '🤥', label: 'Mentiroso', short: 'Mentiroso' },
        { id: 'suitcase', emoji: '🧳', label: 'Mala', short: 'Mala' },
        { id: 'cookie', emoji: '🍪', label: 'Biscoito', short: 'Biscoito' },
        { id: 'broken', emoji: '💔', label: 'Coracao partido', short: 'Partido' },
      ],
      selectedReactions: {},
      reactionCounts: {},
      partialCounts: {},
      partialTimer: null,
    };
  },
  methods: {
    async loadStatus() {
      this.message = '';
      const res = await fetch('/api/public/status');
      const data = await res.json();
      if (!data.week) {
        this.weekTitle = 'Votacao encerrada ou indisponivel';
        this.candidates = [];
        this.hasOpenWeek = false;
        this.currentWeekId = null;
        return;
      }
      this.weekTitle = data.week.title;
      this.candidates = data.candidates || [];
      this.hasOpenWeek = true;
      this.currentWeekId = data.week.id;
    },
    async vote(candidateId) {
      this.message = 'Enviando voto...';
      this.messageColor = '#047857';
      this.loading = true;
      try {
        const res = await fetch('/api/public/vote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ candidateId }),
        });
        const data = await res.json();
        if (!res.ok) {
          this.message = data?.error?.message || 'Erro ao votar.';
          this.messageColor = '#b42318';
        } else {
          this.message = 'Voto registrado com sucesso!';
          this.messageColor = '#047857';
          const current = this.partialsFor(candidateId);
          this.partialCounts = {
            ...this.partialCounts,
            [candidateId]: current + 1,
          };
        }
      } catch (err) {
        this.message = 'Erro ao votar.';
        this.messageColor = '#b42318';
      } finally {
        this.loading = false;
      }
    },
    async loadPartial() {
      try {
        if (!this.currentWeekId) {
          this.partialCounts = {};
          return;
        }
        const res = await fetch(`/api/public/partial?weekId=${this.currentWeekId}`);
        const data = await res.json();
        const map = {};
        (data.candidates || []).forEach((row) => {
          map[row.id] = Number(row.votes || 0);
        });
        this.partialCounts = map;
      } catch (_) {
        this.partialCounts = {};
      }
    },
    startPartialUpdates() {
      if (this.partialTimer) return;
      this.partialTimer = setInterval(() => {
        if (this.hasOpenWeek) {
          this.loadPartial();
        }
      }, 5000);
    },
    stopPartialUpdates() {
      if (this.partialTimer) {
        clearInterval(this.partialTimer);
        this.partialTimer = null;
      }
    },
    async loadReactionCounts() {
      try {
        const res = await fetch('/api/public/reactions');
        const data = await res.json();
        const map = {};
        (data.counts || []).forEach((row) => {
          if (!map[row.participant_name]) map[row.participant_name] = {};
          map[row.participant_name][row.reaction_id] = Number(row.total || 0);
        });
        this.reactionCounts = map;
      } catch (_) {
        this.reactionCounts = {};
      }
    },
    async selectReaction(participantId, reactionId) {
      const participant = this.participants.find((p) => p.id === participantId);
      if (!participant) return;
      this.selectedReactions = {
        ...this.selectedReactions,
        [participantId]: reactionId,
      };
      try {
        const res = await fetch('/api/public/reactions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ participantName: participant.name, reactionId }),
        });
        const data = await res.json();
        if (!res.ok) {
          this.message = data?.error?.message || 'Erro ao registrar reacao.';
          this.messageColor = '#b42318';
        } else {
          await this.loadReactionCounts();
        }
      } catch (_) {
        this.message = 'Erro ao registrar reacao.';
        this.messageColor = '#b42318';
      }
    },
    reactionClass(participantId, reactionId) {
      const isSelected = this.selectedReactions[participantId] === reactionId;
      return isSelected ? 'btn-brand' : 'btn-outline-secondary';
    },
    reactionLabel(reactionId) {
      const r = this.reactions.find((item) => item.id === reactionId);
      return r ? `${r.emoji} ${r.label}` : '';
    },
    reactionCount(participantName, reactionId) {
      return this.reactionCounts?.[participantName]?.[reactionId] || 0;
    },
    candidatePercent(candidateId) {
      const total = this.candidates.reduce(
        (sum, candidate) => sum + this.partialsFor(candidate.id),
        0
      );
      if (!total) return 0;
      const count = this.partialsFor(candidateId);
      const percent = (count / total) * 100;
      return Math.round(percent * 10) / 10;
    },
    partialsFor(candidateId) {
      return this.partialCounts?.[candidateId] || 0;
    },
  },
  async mounted() {
    await this.loadStatus();
    this.loadReactionCounts();
    this.loadPartial();
    this.startPartialUpdates();
  },
  beforeUnmount() {
    this.stopPartialUpdates();
  },
}).mount('#app');
