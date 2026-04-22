export type Language = "th" | "en" | "zh";

export const translations = {
  // Navbar
  nav: {
    services: { th: "บริการ", en: "Services", zh: "服务" },
    products: { th: "สินค้า", en: "Products", zh: "产品" },
    clients: { th: "ลูกค้าของเรา", en: "Our Clients", zh: "我们的客户" },
    contact: { th: "ติดต่อเรา", en: "Contact", zh: "联系我们" },
  },

  // Hero
  hero: {
    tagline: {
      th: "ผู้เชี่ยวชาญด้านเครื่องมือทดสอบและสร้างห้องปฏิบัติการ",
      en: "Experts in Testing Equipment & Laboratory Solutions",
      zh: "测试设备与实验室解决方案专家",
    },
    title: {
      th: "โซลูชันการทดสอบครบวงจร\nสำหรับทุกอุตสาหกรรม",
      en: "Complete Testing Solutions\nfor Every Industry",
      zh: "适用于各行业的\n全方位测试解决方案",
    },
    subtitle: {
      th: "จำหน่าย ซ่อมบำรุง และสอบเทียบเครื่องมือทดสอบคุณภาพ พร้อมบริการออกแบบและสร้างห้องปฏิบัติการมาตรฐานสากล",
      en: "Sales, maintenance, and calibration of quality testing instruments, with design and construction services for international-standard laboratories.",
      zh: "销售、维修和校准优质测试仪器，提供国际标准实验室的设计与建设服务。",
    },
    cta: {
      th: "ติดต่อเรา",
      en: "Contact Us",
      zh: "联系我们",
    },
    ctaLine: {
      th: "แชทผ่าน LINE",
      en: "Chat via LINE",
      zh: "通过LINE聊天",
    },
  },

  // Services
  services: {
    sectionTag: { th: "บริการของเรา", en: "Our Services", zh: "我们的服务" },
    title: {
      th: "บริการครบวงจรที่คุณวางใจ",
      en: "Comprehensive Services You Can Trust",
      zh: "您值得信赖的全方位服务",
    },
    subtitle: {
      th: "เราให้บริการครอบคลุมทุกความต้องการด้านเครื่องมือทดสอบและห้องปฏิบัติการ",
      en: "We cover all your testing equipment and laboratory needs.",
      zh: "我们满足您在测试设备和实验室方面的所有需求。",
    },
    items: [
      {
        icon: "sales",
        title: { th: "จำหน่ายเครื่องมือทดสอบ", en: "Equipment Sales", zh: "设备销售" },
        desc: {
          th: "จำหน่ายเครื่องมือทดสอบคุณภาพจากแบรนด์ชั้นนำ พร้อมให้คำปรึกษาในการเลือกเครื่องที่เหมาะสม",
          en: "Quality testing equipment from leading brands with expert consultation for the right selection.",
          zh: "提供知名品牌的优质测试设备，并提供专业选型咨询。",
        },
      },
      {
        icon: "service",
        title: { th: "ซ่อมบำรุงและสอบเทียบ", en: "Service & Calibration", zh: "维修与校准" },
        desc: {
          th: "บริการซ่อมบำรุง ดูแลรักษา และสอบเทียบเครื่องมือทดสอบทุกประเภท โดยทีมวิศวกรผู้เชี่ยวชาญ",
          en: "Maintenance, repair, and calibration for all types of testing equipment by expert engineers.",
          zh: "由专业工程师团队提供各类测试设备的维修、保养和校准服务。",
        },
      },
      {
        icon: "lab",
        title: { th: "ออกแบบและสร้างห้องแลป", en: "Lab Design & Construction", zh: "实验室设计与建设" },
        desc: {
          th: "ออกแบบและสร้างห้องปฏิบัติการตามมาตรฐานสากล ครบวงจรตั้งแต่การออกแบบจนถึงติดตั้ง",
          en: "Design and build laboratories to international standards, from concept to installation.",
          zh: "按照国际标准设计和建设实验室，从概念设计到安装一条龙服务。",
        },
      },
    ],
  },

  // Products
  products: {
    sectionTag: { th: "สินค้าของเรา", en: "Our Products", zh: "我们的产品" },
    title: {
      th: "เครื่องมือทดสอบคุณภาพ",
      en: "Quality Testing Equipment",
      zh: "优质测试设备",
    },
    subtitle: {
      th: "เราจำหน่ายเครื่องมือทดสอบหลากหลายประเภท ครอบคลุมทุกอุตสาหกรรม",
      en: "We offer a wide range of testing equipment for every industry.",
      zh: "我们提供各种测试设备，覆盖所有行业需求。",
    },
    items: [
      {
        image: "/images/tensile-tester.png",
        title: { th: "เครื่องทดสอบแรงดึง", en: "Tensile Testing Machine", zh: "拉力试验机" },
        desc: {
          th: "ทดสอบแรงดึง แรงฉีก และการยืดของวัสดุ",
          en: "Test tensile strength, tear, and elongation of materials.",
          zh: "测试材料的拉力、撕裂力和伸长率。",
        },
      },
      {
        image: "/images/hardness-tester.png",
        title: { th: "เครื่องวัดความแข็ง", en: "Hardness Tester", zh: "硬度计" },
        desc: {
          th: "วัดค่าความแข็งของโลหะ พลาสติก และยาง",
          en: "Measure hardness of metals, plastics, and rubber.",
          zh: "测量金属、塑料和橡胶的硬度值。",
        },
      },
      {
        image: "/images/compression-tester.png",
        title: { th: "เครื่องทดสอบแรงกด", en: "Compression Tester", zh: "压力试验机" },
        desc: {
          th: "ทดสอบแรงกด ความแข็งแรง และความทนทานของวัสดุ",
          en: "Test compression strength and durability of materials.",
          zh: "测试材料的抗压强度和耐久性。",
        },
      },
      {
        image: "/images/viscometer.png",
        title: { th: "เครื่องวัดความหนืด", en: "Viscometer", zh: "粘度计" },
        desc: {
          th: "วัดค่าความหนืดของของเหลว สี หมึก กาว และอื่นๆ",
          en: "Measure viscosity of liquids, paints, inks, and adhesives.",
          zh: "测量液体、油漆、油墨和粘合剂的粘度。",
        },
      },
      {
        image: "/images/colorimeter.png",
        title: { th: "เครื่องวัดสี", en: "Colorimeter", zh: "色差仪" },
        desc: {
          th: "วัดค่าสีและความแตกต่างของสี ตามมาตรฐาน CIE",
          en: "Measure color values and differences per CIE standards.",
          zh: "按照CIE标准测量颜色值和色差。",
        },
      },
      {
        image: "/images/cof-tester.png",
        title: { th: "เครื่องวัดค่า COF", en: "COF Tester", zh: "摩擦系数测试仪" },
        desc: {
          th: "วัดค่าสัมประสิทธิ์แรงเสียดทานของฟิล์มและบรรจุภัณฑ์",
          en: "Measure coefficient of friction for films and packaging.",
          zh: "测量薄膜和包装材料的摩擦系数。",
        },
      },
      {
        image: "/images/leak-tester.png",
        title: { th: "เครื่อง Leak Test", en: "Leak Tester", zh: "泄漏测试仪" },
        desc: {
          th: "ทดสอบการรั่วซึมของบรรจุภัณฑ์ด้วยระบบสุญญากาศ",
          en: "Test package seal integrity with vacuum systems.",
          zh: "利用真空系统测试包装的密封完整性。",
        },
      },
      {
        image: "/images/film-tester.png",
        title: {
          th: "เครื่องทดสอบฟิล์ม/แพ็คเกจจิ้ง",
          en: "Film & Packaging Tester",
          zh: "薄膜/包装测试仪",
        },
        desc: {
          th: "ทดสอบคุณสมบัติของพลาสติกฟิล์มและบรรจุภัณฑ์",
          en: "Test properties of plastic films and packaging materials.",
          zh: "测试塑料薄膜和包装材料的性能。",
        },
      },
      {
        image: "/images/lab-construction.png",
        title: { th: "งานสร้างห้องแลป", en: "Lab Construction", zh: "实验室建设" },
        desc: {
          th: "ออกแบบและก่อสร้างห้องปฏิบัติการมาตรฐานสากล",
          en: "Design and build international-standard laboratories.",
          zh: "设计和建设国际标准实验室。",
        },
      },
    ],
  },

  // Clients
  clients: {
    sectionTag: { th: "ลูกค้าของเรา", en: "Our Clients", zh: "我们的客户" },
    title: {
      th: "ได้รับความไว้วางใจจากองค์กรชั้นนำ",
      en: "Trusted by Leading Organizations",
      zh: "深受领先企业信赖",
    },
    subtitle: {
      th: "เราภูมิใจที่ได้ร่วมงานกับบริษัทชั้นนำมากมายทั่วประเทศ",
      en: "We're proud to work with leading companies nationwide.",
      zh: "我们很荣幸与全国各地的领先企业合作。",
    },
  },

  // Contact
  contact: {
    sectionTag: { th: "ติดต่อเรา", en: "Contact Us", zh: "联系我们" },
    title: {
      th: "พร้อมให้บริการ",
      en: "Ready to Serve You",
      zh: "随时为您服务",
    },
    subtitle: {
      th: "ติดต่อเราได้ทุกช่องทาง เรายินดีให้คำปรึกษาและบริการ",
      en: "Reach us through any channel. We're happy to assist.",
      zh: "通过任何渠道联系我们，我们很乐意为您提供帮助。",
    },
    address: {
      th: "89/99 ถ.ติวานนท์ ต.บางกระสอ อ.เมืองนนทบุรี จ.นนทบุรี 11000",
      en: "89/99 Tiwanon Rd., Bang Kra Sor, Mueang Nonthaburi, Nonthaburi 11000, Thailand",
      zh: "泰国暖武里府暖武里市邦沙叻镇蒂瓦侬路89/99号 11000",
    },
    phone: {
      th: "02-xxx-xxxx",
      en: "02-xxx-xxxx",
      zh: "02-xxx-xxxx",
    },
    email: {
      th: "ampumin@gmail.com",
      en: "ampumin@gmail.com",
      zh: "ampumin@gmail.com",
    },
    form: {
      name: { th: "ชื่อ-นามสกุล", en: "Full Name", zh: "姓名" },
      email: { th: "อีเมล", en: "Email", zh: "电子邮件" },
      subject: { th: "หัวข้อ", en: "Subject", zh: "主题" },
      message: { th: "ข้อความ", en: "Message", zh: "留言内容" },
      send: { th: "ส่งข้อความ", en: "Send Message", zh: "发送消息" },
      sending: { th: "กำลังส่ง...", en: "Sending...", zh: "发送中..." },
      success: {
        th: "ส่งข้อความเรียบร้อยแล้ว!",
        en: "Message sent successfully!",
        zh: "消息发送成功！",
      },
    },
    addressLabel: { th: "ที่อยู่", en: "Address", zh: "地址" },
    phoneLabel: { th: "โทรศัพท์", en: "Phone", zh: "电话" },
    emailLabel: { th: "อีเมล", en: "Email", zh: "电子邮件" },
    lineLabel: { th: "LINE", en: "LINE", zh: "LINE" },
  },

  // Footer
  footer: {
    description: {
      th: "ผู้เชี่ยวชาญด้านเครื่องมือทดสอบและสร้างห้องปฏิบัติการ ให้บริการจำหน่าย ซ่อมบำรุง และสอบเทียบ",
      en: "Experts in testing equipment and laboratory construction. Sales, service, and calibration.",
      zh: "测试设备与实验室建设专家。提供销售、维修和校准服务。",
    },
    quickLinks: { th: "ลิงก์ด่วน", en: "Quick Links", zh: "快速链接" },
    contactInfo: { th: "ข้อมูลติดต่อ", en: "Contact Info", zh: "联系信息" },
    copyright: {
      th: "© 2026 I Don't Know Tech. สงวนลิขสิทธิ์.",
      en: "© 2026 I Don't Know Tech. All rights reserved.",
      zh: "© 2026 I Don't Know Tech. 版权所有。",
    },
  },
} as const;

export type TranslationKey = keyof typeof translations;
