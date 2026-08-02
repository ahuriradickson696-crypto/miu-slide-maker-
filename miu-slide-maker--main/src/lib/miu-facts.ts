// Metropolitan International University (MIU) institutional facts, used to
// keep generated documents accurate and consistent instead of re-typing
// (or drifting on) the same details in every document template.
//
// Sourced from miu.ac.ug (About, Vision/Mission/Core Values, Our Campuses,
// Contact Us, FAQs pages) and Wikipedia's "Metropolitan International
// University" article, current as of this file's writing. If MIU's public
// details change (new campus, new motto, etc.), update here rather than
// hunting through every document template.

export const MIU_FACTS = {
  legalName: "Metropolitan International University",
  shortName: "MIU",
  motto: "Empowerment through knowledge creation",
  founded: 2016,
  accreditation:
    "Licensed and accredited by Uganda's National Council for Higher Education (NCHE), License No. UIPL022",
  vision:
    "To be a premier, student-centered learning community dedicated to academic excellence, innovation, research, and transformation.",
  mission:
    "To transform the lives of our students and communities through the provision of essential, up-to-date, market-oriented vocational, entrepreneurial, and management training.",
  website: "www.miu.ac.ug",
  email: "info@miu.ac.ug",
  campuses: [
    {
      name: "Kisoro (Main Campus)",
      address: "Kisoro-Kabale Rd, Northern Division, Kisoro Municipality, P.O. Box 160, Kisoro, Uganda",
    },
    { name: "Mbarara Campus", address: "Mbarara, Uganda" },
    {
      name: "Kampala Campus",
      address: "Namungoona, Plot 281 along Nakibinge Road (off Kampala–Hoima Road), Kampala, Uganda",
    },
  ],
  campusesShort: "Kisoro • Mbarara • Kampala",
} as const;
