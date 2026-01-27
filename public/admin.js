const { createApp } = Vue;

createApp({
  data() {
    return {
      weeks: [],
      currentWeekId: null,
      weekMeta: '',
      newWeekTitle: '',
      candidates: [
        { name: '' },
        { name: '' },
        { name: '' },
      ],
      results: [],
      imageFiles: [null, null, null],
      imageStatus: ['Sem imagem.', 'Sem imagem.', 'Sem imagem.'],
      adminMessage: '',
      adminMessageColor: '#047857',
    };
  },
  methods: {
    setAdminMessage(text, isError) {
      this.adminMessage = text || '';
      this.adminMessageColor = isError ? '#b42318' : '#047857';
    },
    async apiRequest(path, options) {
      const res = await fetch(path, {
        headers: { 'Content-Type': 'application/json' },
        ...options,
      });
      let data = null;
      try {
        data = await res.json();
      } catch (_) {
        // ignore
      }
      if (!res.ok) {
        const msg = data?.error?.message || 'Erro na requisicao.';
        throw new Error(msg);
      }
      return data;
    },
    async loadWeeks() {
      const data = await this.apiRequest('/admin/weeks');
      this.weeks = data.weeks || [];
      if (this.weeks.length) {
        this.currentWeekId = this.weeks[0].id;
        this.updateWeekMeta();
        await this.loadWeekDetails();
      } else {
        this.currentWeekId = null;
        this.weekMeta = 'Nenhuma semana criada.';
      }
    },
    updateWeekMeta() {
      const w = this.weeks.find((wk) => wk.id === this.currentWeekId);
      if (!w) {
        this.weekMeta = '';
        return;
      }
      const closed = w.closed_at ? `fechada em ${w.closed_at}` : '';
      this.weekMeta = `Status: ${w.status}. Criada em ${w.created_at}. ${closed}`;
    },
    async loadWeekDetails() {
      if (!this.currentWeekId) return;
      const data = await this.apiRequest(`/admin/weeks/${this.currentWeekId}/results`);
      this.results = data.results || [];
      this.results.forEach((r, idx) => {
        if (this.candidates[idx]) this.candidates[idx].name = r.name;
        this.imageStatus[idx] = r.image_url ? 'Imagem salva.' : 'Sem imagem.';
      });
    },
    async createWeek() {
      this.setAdminMessage('', false);
      try {
        await this.apiRequest('/admin/weeks', {
          method: 'POST',
          body: JSON.stringify({ title: this.newWeekTitle || undefined }),
        });
        this.newWeekTitle = '';
        await this.loadWeeks();
        this.setAdminMessage('Semana criada com sucesso.', false);
      } catch (err) {
        this.setAdminMessage(err.message, true);
      }
    },
    async openWeek() {
      if (!this.currentWeekId) return;
      this.setAdminMessage('', false);
      try {
        await this.apiRequest(`/admin/weeks/${this.currentWeekId}/open`, { method: 'POST' });
        await this.loadWeeks();
        this.setAdminMessage('Semana aberta.', false);
      } catch (err) {
        this.setAdminMessage(err.message, true);
      }
    },
    async closeWeek() {
      if (!this.currentWeekId) return;
      this.setAdminMessage('', false);
      try {
        await this.apiRequest(`/admin/weeks/${this.currentWeekId}/close`, { method: 'POST' });
        await this.loadWeeks();
        this.setAdminMessage('Semana fechada.', false);
      } catch (err) {
        this.setAdminMessage(err.message, true);
      }
    },
    async saveCandidates() {
      if (!this.currentWeekId) return;
      const names = this.candidates.map((c) => c.name.trim());
      this.setAdminMessage('', false);
      try {
        await this.apiRequest(`/admin/weeks/${this.currentWeekId}/candidates`, {
          method: 'PUT',
          body: JSON.stringify({ names }),
        });
        await this.loadWeekDetails();
        this.setAdminMessage('Nomes atualizados.', false);
      } catch (err) {
        this.setAdminMessage(err.message, true);
      }
    },
    async refreshResults() {
      try {
        await this.loadWeekDetails();
      } catch (err) {
        this.setAdminMessage(err.message, true);
      }
    },
    onWeekChange() {
      this.updateWeekMeta();
      this.loadWeekDetails();
    },
    onFileChange(slot, event) {
      const file = event?.target?.files?.[0] || null;
      this.imageFiles[slot - 1] = file;
      if (!file) {
        this.imageStatus[slot - 1] = 'Selecione um JPEG.';
      } else if (file.type !== 'image/jpeg') {
        this.imageStatus[slot - 1] = 'Apenas JPEG.';
      } else {
        this.imageStatus[slot - 1] = 'Pronto para enviar.';
      }
    },
    async uploadImage(slot) {
      if (!this.currentWeekId) return;
      const file = this.imageFiles[slot - 1];
      if (!file) {
        this.imageStatus[slot - 1] = 'Selecione um JPEG.';
        return;
      }
      if (file.type !== 'image/jpeg') {
        this.imageStatus[slot - 1] = 'Apenas JPEG.';
        return;
      }
      const formData = new FormData();
      formData.append('image', file);
      try {
        const res = await fetch(
          `/admin/weeks/${this.currentWeekId}/candidates/${slot}/image`,
          { method: 'POST', body: formData }
        );
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.error?.message || 'Erro ao enviar imagem.');
        }
        this.imageStatus[slot - 1] = 'Imagem enviada.';
        await this.loadWeekDetails();
      } catch (err) {
        this.imageStatus[slot - 1] = err.message;
      }
    },
  },
  mounted() {
    this.loadWeeks();
  },
}).mount('#adminApp');
