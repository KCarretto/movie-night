import fs from 'fs';
let code = fs.readFileSync('src/App.jsx', 'utf-8');
const searchStr = `<div className="grid xl:grid-cols-[1fr_1.1fr] gap-4">
                <div className="space-y-4 flex flex-col order-last xl:order-none">
                  <Recommendations
                    onOpenRec={(rec) => setRecDetail(rec)}
                    onOpenInsights={() => setInsightsOpen(true)}
                    onOpenTrain={() => setTrainOpen(true)}
                    onOpenRate={openRate}
                  />
                  <Nominate onOpenStartVote={() => setStartVoteOpen(true)} />
                </div>
              </div>`;
const replaceStr = `<div className="grid gap-4">
                <div className="space-y-4 flex flex-col">
                  <Recommendations
                    onOpenRec={(rec) => setRecDetail(rec)}
                    onOpenInsights={() => setInsightsOpen(true)}
                    onOpenTrain={() => setTrainOpen(true)}
                    onOpenRate={openRate}
                  />
                  <Nominate onOpenStartVote={() => setStartVoteOpen(true)} />
                </div>
              </div>`;
if (code.includes(searchStr)) {
  fs.writeFileSync('src/App.jsx', code.replace(searchStr, replaceStr));
  console.log('patched');
} else {
  console.log('not found');
}
