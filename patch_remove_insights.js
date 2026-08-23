const fs = require('fs');
const file = 'app/dashboard/page.tsx';
let code = fs.readFileSync(file, 'utf8');

const target = `        {/* ── Smart Insights ──────────────────────────────────────────────── */}
        {data && data.insights.length > 0 && (
          <div className="mb-8">
            <h2 className="text-lg font-bold text-gray-800 mb-4">💡 วิเคราะห์อัจฉริยะ</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {data.insights.map((insight, i) => (
                <div
                  key={i}
                  className={\`rounded-2xl p-5 border shadow-sm \${insight.type === "positive" ? "bg-emerald-50 border-emerald-200" :
                      insight.type === "warning" ? "bg-amber-50 border-amber-200" :
                        insight.type === "opportunity" ? "bg-blue-50 border-blue-200" :
                          "bg-gray-50 border-gray-200"
                    }\`}
                >
                  <div className="text-2xl mb-2">{insight.icon}</div>
                  <div className="font-semibold text-gray-800 text-sm mb-1">{insight.title}</div>
                  <div className="text-xs text-gray-500">{insight.description}</div>
                </div>
              ))}
            </div>
          </div>
        )}

`;

code = code.replace(target, "");
fs.writeFileSync(file, code);
