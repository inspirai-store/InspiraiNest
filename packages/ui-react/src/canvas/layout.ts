export type Point={x:number;y:number};
export type BoardLayout={positions:Record<string,Point>;viewport?:Point&{zoom:number}};
export function readBoardLayout(storage:Pick<Storage,'getItem'>,key:string):BoardLayout{
 try{const raw=JSON.parse(storage.getItem(key)||'null');const positions:Record<string,Point>={};for(const [id,p]of Object.entries(raw?.positions||{})){const point=p as Point;if(Number.isFinite(point.x)&&Number.isFinite(point.y))positions[id]={x:point.x,y:point.y};}const v=raw?.viewport;return{positions,...(v&&Number.isFinite(v.x)&&Number.isFinite(v.y)&&v.zoom>=.15&&v.zoom<=2?{viewport:v}:{})};}catch{return{positions:{}};}
}
export function mergeBoardPositions(layout:BoardLayout,items:{id:string;position:Point}[]):BoardLayout{return{...layout,positions:{...layout.positions,...Object.fromEntries(items.map(n=>[n.id,n.position]))}};}
