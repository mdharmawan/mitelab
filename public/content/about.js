/* About page content (ABT-5): edit text, photos and links here without touching code.
 * photo: a path under /content/ (e.g. "/content/photos/arief.jpg") or "" to show initials.
 * Each person must approve their text and photo before release (ABT-6). */
window.ABOUT = {
  version: '1.0.0',
  modelDocUrl: '#about-model',
  profiles: [
    {
      id: 'arief',
      name: 'Mohammad Arief Dharmawan',
      photo: '',
      links: [],
      role: { en: 'Product owner', id: 'Product owner' },
      position: {
        en: 'Doctoral candidate, Doctor of Science in Management, SBM ITB',
        id: 'Kandidat doktor, Doktor Sains Manajemen, SBM ITB',
      },
      bio: {
        en: 'Mohammad Arief Dharmawan is a doctoral candidate in the Doctor of Science in Management program at SBM ITB and the designer of this simulation. His research, the Digital Twin Adoption-Scaling Model (DT-ASM), studies how digital technologies are first adopted and then scaled in Indonesia’s upstream oil and gas sector, the same journey MITE Lab makes in this game.',
        id: 'Mohammad Arief Dharmawan adalah kandidat doktor pada program Doktor Sains Manajemen SBM ITB dan perancang simulasi ini. Risetnya, Digital Twin Adoption-Scaling Model (DT-ASM), mengkaji bagaimana teknologi digital diadopsi lalu diskalakan di sektor hulu minyak dan gas Indonesia, perjalanan yang sama dengan yang ditempuh MITE Lab dalam permainan ini.',
      },
    },
    {
      id: 'wawan',
      name: 'Prof. Wawan Dhewanto, PhD',
      photo: '',
      links: [{ label: 'SBM ITB', url: 'https://www.sbm.itb.ac.id/?p=68130' }],
      role: { en: 'Academic advisor', id: 'Penasihat akademik' },
      position: {
        en: 'Professor of Entrepreneurship, School of Business and Management, Institut Teknologi Bandung (SBM ITB)',
        id: 'Guru Besar Kewirausahaan, Sekolah Bisnis dan Manajemen, Institut Teknologi Bandung (SBM ITB)',
      },
      bio: {
        en: 'Prof. Wawan Dhewanto, PhD, is Professor of Entrepreneurship at the School of Business and Management, Institut Teknologi Bandung (SBM ITB). In 2021 he became ITB’s first professor in entrepreneurship and startups. He was the founding director of SBM ITB’s Bachelor of Entrepreneurship program (2013–2018) and Secretary of the ITB Academic Senate (2019–2024). His expertise covers technology commercialisation, start-up ecosystems and SME scale-up. He studied Industrial Engineering at ITB and holds an MSc from TU Delft and a PhD from Monash University.',
        id: 'Prof. Wawan Dhewanto, PhD, adalah Guru Besar Kewirausahaan di Sekolah Bisnis dan Manajemen, Institut Teknologi Bandung (SBM ITB). Pada 2021 ia menjadi guru besar pertama ITB di bidang kewirausahaan dan startup. Ia adalah direktur pertama Program Sarjana Kewirausahaan SBM ITB (2013–2018) dan Sekretaris Senat Akademik ITB (2019–2024). Keahliannya meliputi komersialisasi teknologi, ekosistem startup, dan peningkatan skala UKM. Ia menempuh studi Teknik Industri di ITB, meraih MSc dari TU Delft, dan PhD dari Monash University.',
      },
    },
    {
      id: 'eko',
      name: 'Dr.rer.pol. Eko Agus Prasetio, MBA, CIM',
      photo: '',
      links: [{ label: 'SBM ITB', url: 'https://sbm.itb.ac.id/member/eko-prasetio' }],
      role: { en: 'Academic advisor', id: 'Penasihat akademik' },
      position: {
        en: 'Associate Professor in Management of Technological Innovation; Vice Dean for Academic Affairs; Head of the Management of Technology Laboratory, SBM ITB',
        id: 'Lektor Kepala bidang Manajemen Inovasi Teknologi; Wakil Dekan Bidang Akademik; Kepala Laboratorium Manajemen Teknologi, SBM ITB',
      },
      bio: {
        en: 'Dr. Eko Agus Prasetio is Associate Professor in Management of Technological Innovation at SBM ITB, where he serves as Vice Dean for Academic Affairs and heads the Management of Technology Laboratory. His research examines technology acceptance and the diffusion of disruptive innovation, using social network analysis and agent-based modelling, ideas this game puts into play. He studied Engineering Physics at ITB, holds an MBA from Nyenrode Business University in the Netherlands and a PhD from Friedrich Schiller University Jena in Germany.',
        id: 'Dr. Eko Agus Prasetio adalah Lektor Kepala bidang Manajemen Inovasi Teknologi di SBM ITB, tempat ia menjabat Wakil Dekan Bidang Akademik dan memimpin Laboratorium Manajemen Teknologi. Risetnya mengkaji penerimaan teknologi dan difusi inovasi disruptif dengan analisis jejaring sosial dan pemodelan berbasis agen, gagasan yang dihidupkan dalam permainan ini. Ia menempuh studi Teknik Fisika di ITB, meraih MBA dari Nyenrode Business University di Belanda, dan PhD dari Friedrich Schiller University Jena di Jerman.',
      },
    },
  ],
};
