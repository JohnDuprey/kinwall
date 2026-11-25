// Pure browser/server travel context. No persistence, geolocation or runtime dependencies.
type Stop = { id: string; timezone: string | null; arriveDate: string | null; leaveDate: string | null };
type Leg = { id?: string; booking: string; departDate: string | null; departTime: string | null; departTz: string | null; arriveDate: string | null; arriveTime: string | null; arriveTz: string | null; memberIds?: string[]; mode?: string };
type ClockTrip = { startDate: string | null; endDate: string | null; viewTimeZone?: string | null; memberIds?: string[]; stops: Stop[]; legs: Leg[] };
const wholeTripLeg = (trip: ClockTrip, leg: Leg) => !leg.memberIds?.length || (trip.memberIds ?? []).every(id=>leg.memberIds!.includes(id));
export type TravelDay = { today: string; timeZone: string; source: 'override' | 'stop' | 'leg' | 'home'; stopId: string | null };
const formats = new Map<string,Intl.DateTimeFormat>();
function validZone(zone: string | null | undefined): zone is string {
  if (!zone) return false;
  if(formats.has(zone)) return true;
  try { new Intl.DateTimeFormat('en', { timeZone: zone }); return true; } catch { return false; }
}
function local(at: Date, zone: string) {
  let f=formats.get(zone);
  if(!f){
    f=new Intl.DateTimeFormat('en-CA', {timeZone: zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
    if(formats.size>=64)formats.delete(formats.keys().next().value!);
    formats.set(zone,f);
  }
  const parts = f.formatToParts(at);
  const p = Object.fromEntries(parts.map(p => [p.type,p.value]));
  return {date:`${p.year}-${p.month}-${p.day}`,time:`${p.hour}:${p.minute}`};
}
/** Unknown, invalid or nonexistent local endpoints cannot support an exact claim. */
export function zonedInstant(date: string | null, time: string | null, zone: string | null): Date | null {
  if (!date || !time || !validZone(zone) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  const target = Date.parse(`${date}T${time}:00Z`);
  if (!Number.isFinite(target) || new Date(target).toISOString().slice(0,16)!==`${date}T${time}`) return null;
  let value = target;
  for (let i=0;i<4;i++) {
    const p = local(new Date(value),zone);
    const delta = target - Date.parse(`${p.date}T${p.time}:00Z`);
    if (!delta) {
      // Repeated local hours have two UTC answers. Without an explicit offset they
      // are unknown, so advisory checks and the live clock must not guess one.
      const offset=target-value;
      for(const shift of [-86400000,86400000]) {
        const sample=value+shift,p=local(new Date(sample),zone);
        const otherOffset=Date.parse(`${p.date}T${p.time}:00Z`)-sample;
        const alternative=value+offset-otherOffset;
        if(alternative!==value) {
          const q=local(new Date(alternative),zone);
          if(q.date===date && q.time===time)return null;
        }
      }
      return new Date(value);
    }
    value += delta;
  }
  return null;
}
export function tripClock(trip: ClockTrip, instant: Date | number, homeZone: string): TravelDay {
  const at = new Date(instant), home = validZone(homeZone) ? homeZone : 'UTC';
  const result = (zone: string, source: TravelDay['source'], stopId: string | null = null): TravelDay => ({today:local(at,zone).date,timeZone:zone,source,stopId});
  if (validZone(trip.viewTimeZone)) return result(trip.viewTimeZone,'override');
  const endpoints = trip.legs.filter(l=>l.booking !== 'canceled' && l.mode !== 'rental' && wholeTripLeg(trip,l)).flatMap(l=> {
    const a=zonedInstant(l.departDate,l.departTime,l.departTz), b=zonedInstant(l.arriveDate,l.arriveTime,l.arriveTz);
    return a && b && b<=a ? [] : [{l,a:a ? +a : null,b:b ? +b : null}];
  });
  const traveling=endpoints.filter(l=>l.a!==null && l.b!==null && l.a<=+at && +at<l.b);
  if (traveling.length) {
    const zones=new Set(traveling.map(v=>v.l.departTz!));
    return zones.size===1 ? result(traveling[0].l.departTz!,'leg') : result(home,'home');
  }
  const departing=endpoints.filter(v=>v.a!==null && +at<v.a && local(at,v.l.departTz!).date===v.l.departDate).sort((a,b)=>a.a!-b.a!);
  if(departing.length) {
    const first=departing[0];
    if(departing.some(v=>v.a===first.a && v.l.departTz!==first.l.departTz))return result(home,'home');
    return result(first.l.departTz!,'leg');
  }
  const stops=trip.stops.filter(s=>s.arriveDate && s.leaveDate && validZone(s.timezone) && s.arriveDate<=local(at,s.timezone).date && local(at,s.timezone).date<s.leaveDate);
  // An unknown-zone stop that could be current makes automatic selection ambiguous.
  const unknown=trip.stops.some(s=>!validZone(s.timezone) && s.arriveDate && s.leaveDate && s.arriveDate<=local(at,home).date && local(at,home).date<s.leaveDate);
  if (stops.length && !unknown && new Set(stops.map(s=>s.timezone)).size===1) return result(stops[0].timezone!,'stop',stops[0].id);
  if (stops.length || unknown) return result(home,'home');
  // Arrival zone is known only on the arrival calendar day; do not extend stale legs forever.
  const arrived=endpoints.filter(v=>v.b!==null && v.b<=+at && local(at,v.l.arriveTz!).date===v.l.arriveDate).sort((a,b)=>b.b!-a.b!);
  if (arrived.length && !arrived.some(v=>v.b===arrived[0].b && v.l.arriveTz!==arrived[0].l.arriveTz)) return result(arrived[0].l.arriveTz!,'leg');
  return result(home,'home');
}
export type PlanCheck = {code:'uncovered_nights'|'overlapping_stays'|'outside_trip'|'travel_overlap'|'travel_backwards';part:'stays'|'travel'|'stops'|'plan';from:string|null;to:string|null;ids:string[];count?:number};
type PlanTrip = ClockTrip & {memberIds?:string[];canceledAt?:string|null;stayGroups:{id:string;checkIn:string|null;checkOut:string|null;chosenOptionId:string|null;options:{id:string;booking:string}[]}[];items:{id:string;date:string|null}[]};
const days=(a:string,b:string)=>Math.round((Date.parse(b+'T00:00Z')-Date.parse(a+'T00:00Z'))/86400000);
export function planChecks(trip: PlanTrip): PlanCheck[] {
  if(trip.canceledAt) return [];
  const checks:PlanCheck[]=[];
  const add=(c:PlanCheck)=>{if(checks.length<200)checks.push(c);};
  const outside=(part:PlanCheck['part'],id:string,from:string|null,to=from)=>{
    if(!trip.startDate || !trip.endDate) return;
    if((from && (from<trip.startDate || from>trip.endDate)) || (to && (to<trip.startDate || to>trip.endDate))) add({code:'outside_trip',part,from,to,ids:[id]});
  };
  for(const s of trip.stops)outside('stops',s.id,s.arriveDate,s.leaveDate);
  for(const i of trip.items)outside('plan',i.id,i.date);
  const stays=trip.stayGroups.filter(g=>g.options.some(o=>o.id===g.chosenOptionId && o.booking!=='canceled'));
  for(const g of trip.stayGroups)if(!g.options.length || g.options.some(o=>o.booking!=='canceled'))outside('stays',g.id,g.checkIn,g.checkOut);
  const intervals=stays.flatMap(g=>g.checkIn && g.checkOut && g.checkIn<g.checkOut ? [{from:g.checkIn,to:g.checkOut,id:g.id}] : []).sort((a,b)=>a.from.localeCompare(b.from));
  overlapStays: for(let i=0;i<intervals.length;i++)for(let j=i+1;j<intervals.length;j++) {
    if(checks.length>=200)break overlapStays;
    if(intervals[j].from>=intervals[i].to)break;
    const a=intervals[i],b=intervals[j],from=a.from>b.from?a.from:b.from,to=a.to<b.to?a.to:b.to;
    if(from<to)add({code:'overlapping_stays',part:'stays',from,to,ids:[a.id,b.id]});
  }
  const legs=trip.legs.filter(l=>l.booking!=='canceled');
  const timed=legs.flatMap(l=>{
    outside('travel',l.id!,l.departDate,l.arriveDate);
    const a=zonedInstant(l.departDate,l.departTime,l.departTz),b=zonedInstant(l.arriveDate,l.arriveTime,l.arriveTz);
    if(!a || !b)return [];
    if(b<a){add({code:'travel_backwards',part:'travel',from:l.departDate,to:l.arriveDate,ids:[l.id!]});return [];}
    if(l.mode==='rental')return [];
    return [{l,a:+a,b:+b}];
  }).sort((a,b)=>a.a-b.a);
  overlapTravel: for(let i=0;i<timed.length;i++)for(let j=i+1;j<timed.length;j++) {
    if(checks.length>=200)break overlapTravel;
    if(timed[j].a>=timed[i].b)break;
    const a=timed[i],b=timed[j],samePeople=!a.l.memberIds?.length || !b.l.memberIds?.length || a.l.memberIds.some(id=>b.l.memberIds!.includes(id));
    if(samePeople && a.a<b.b && b.a<a.b)add({code:'travel_overlap',part:'travel',from:a.l.departDate,to:b.l.arriveDate,ids:[a.l.id!,b.l.id!]});
  }
  // Determinable overnight transportation accounts for nights in transit. Date-line legs
  // whose local arrival date moves backwards are left unknown, never expanded into guessed days.
  for(const {l,a,b} of timed)if(b>a && l.departDate && l.arriveDate && l.departDate<l.arriveDate && ['flight','train','bus','ferry'].includes(l.mode??'') && (!l.memberIds?.length || !!trip.memberIds?.length && trip.memberIds.every(id=>l.memberIds!.includes(id))))intervals.push({from:l.departDate,to:l.arriveDate,id:l.id!});
  if(trip.startDate && trip.endDate && trip.startDate<trip.endDate){
    let cursor=trip.startDate;
    const gap=(from:string,to:string)=>add({code:'uncovered_nights',part:'stays',from,to,ids:[],count:days(from,to)});
    for(const i of intervals.sort((a,b)=>a.from.localeCompare(b.from))){
      if(i.to<=cursor || i.from>=trip.endDate)continue;
      if(i.from>cursor)gap(cursor,i.from);
      if(i.to>cursor)cursor=i.to;
    }
    if(cursor<trip.endDate)gap(cursor,trip.endDate);
  }
  return checks;
}
