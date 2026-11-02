using Godot;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.IO;

// Presentation only: all positions, health, energy, actions and projectiles come from TS snapshots.
public partial class BattleCanvas : Control
{
    public JsonElement Current,Previous;
    public double VisualSeconds;
    public float Alpha=1;
    public int FloorNumber=1;
    public string Background="forest";
    private JsonElement layout;
    private readonly Dictionary<string,Texture2D> sheets=new();
    private readonly Dictionary<string,int> sizes=new();
    private readonly Dictionary<string,string> names=new();
    private readonly Font font=new SystemFont{FontNames=new[]{"Noto Sans CJK SC","sans-serif"}};
    public void SetConfig(JsonElement config)
    {
        using(var doc=JsonDocument.Parse(File.ReadAllText(ProjectSettings.GlobalizePath("res://generated/sprite-layout.json"))))layout=doc.RootElement.Clone();
        names["hero"]="主角";names["princess"]="公主";sizes["hero"]=sizes["princess"]=16;
        foreach(var s in config.GetProperty("Species").EnumerateArray()){
            var id=s.GetProperty("Id").GetString()!;names[id]=s.GetProperty("Name").GetString()!;sizes[id]=s.GetProperty("FrameSize").GetInt32();
        }
        foreach(var id in names.Keys)
            sheets[id]=GD.Load<Texture2D>($"res://generated/sprites/{id}.png");
        TextureFilter=TextureFilterEnum.Nearest;
    }
    public void SetDisplayNames(IReadOnlyDictionary<string,string> display){foreach(var id in names.Keys.ToArray())if(display.TryGetValue(id,out var name))names[id]=name;}
    private Vector2 At(double x,double z)=>new((float)((x+12.5)/25*Size.X),(float)(Size.Y*.53+z/12*Size.Y*.57));
    private static double Number(JsonElement e,string key)=>e.GetProperty(key).GetDouble();
    private Vector2 InterpolatedPosition(JsonElement unit,string collection)
    {
        var x=Number(unit,"x");var z=Number(unit,"z");
        if(Previous.ValueKind==JsonValueKind.Object){
            foreach(var old in Previous.GetProperty(collection).EnumerateArray())if(old.GetProperty("id").ToString()==unit.GetProperty("id").ToString()){
                x=Number(old,"x")+(x-Number(old,"x"))*Alpha;z=Number(old,"z")+(z-Number(old,"z"))*Alpha;break;
            }
        }
        return At(x,z);
    }
    private void Text(string text,Vector2 p,int size,Color color,bool centered=true)
    {
        if(centered)p.X-=font.GetStringSize(text,HorizontalAlignment.Left,-1,size).X/2;
        DrawString(font,p,text,HorizontalAlignment.Left,-1,size,color);
    }
    public Rect2 Pose(JsonElement unit,double seconds)
    {
        var human=unit.GetProperty("kind").GetString() is "hero" or "princess";
        var s=sizes[unit.GetProperty("kind").GetString()!];
        JsonElement old=default;
        if(Previous.ValueKind==JsonValueKind.Object)old=Previous.GetProperty("units").EnumerateArray().FirstOrDefault(v=>v.GetProperty("id").ToString()==unit.GetProperty("id").ToString());
        var dx=old.ValueKind==JsonValueKind.Object?Number(unit,"x")-Number(old,"x"):0;
        var dz=old.ValueKind==JsonValueKind.Object?Number(unit,"z")-Number(old,"z"):0;
        var victory=Current.GetProperty("result").GetString()=="victory"&&!unit.GetProperty("enemy").GetBoolean()&&Number(unit,"hp")>0;
        var action=unit.GetProperty("action");JsonElement target=default;
        if(action.ValueKind==JsonValueKind.Object)target=Current.GetProperty("units").EnumerateArray().FirstOrDefault(v=>v.GetProperty("id").GetString()==action.GetProperty("target").GetString());
        var facing=Math.Abs(dx)>1e-6?dx:target.ValueKind==JsonValueKind.Object&&Math.Abs(Number(target,"x")-Number(unit,"x"))>1e-6?Number(target,"x")-Number(unit,"x"):unit.GetProperty("enemy").GetBoolean()?-1:1;
        var row=layout.GetProperty(victory?"frontRow":facing<0?"sideLeftRow":"sideRightRow").GetInt32();
        var walking=Number(unit,"hp")>0&&(victory||Math.Abs(dx)+Math.Abs(dz)>1e-6||Number(unit,"entry")>0);
        var frames=layout.GetProperty("walkFrames");
        var frame=walking?frames[(int)(Math.Max(0,seconds)*layout.GetProperty("fps").GetDouble())%frames.GetArrayLength()].GetInt32():1;
        return new Rect2(frame*s,row*(human?layout.GetProperty("humanRowStride").GetInt32():s)+(human?layout.GetProperty("humanCropY").GetInt32():0),s,s);
    }
    public override void _Draw()
    {
        DrawRect(new Rect2(Vector2.Zero,Size),new Color(Background=="coast"?"718d83":Background=="dragon"?"746044":Background=="castle"?"677273":"6c866a"));
        DrawRect(new Rect2(0,0,Size.X,Size.Y*.34f),new Color("425f55"));
        for(int i=0;i<25;i++){
            float x=i*Size.X/24,y=Size.Y*.30f+(i%3)*7;
            DrawRect(new Rect2(x-3,y-26,6,50),new Color("423c2e"));
            for(int tier=0;tier<3;tier++){
                var tip=new Vector2(x,y-70+tier*20);float spread=21+tier*8;
                DrawColoredPolygon(new[]{tip,tip+new Vector2(-spread,55),tip+new Vector2(spread,55)},new Color(i%2==0?"294b3c":"315443"));
            }
        }
        DrawStyleBox(new StyleBoxFlat{BgColor=new Color("aeb08130"),CornerRadiusTopLeft=100,CornerRadiusTopRight=100,CornerRadiusBottomLeft=100,CornerRadiusBottomRight=100},new Rect2(Size.X*.03f,Size.Y*.37f,Size.X*.94f,Size.Y*.58f));
        for(int x=-12;x<=12;x+=2)DrawLine(At(x,-5),At(x,5),new Color("c6cea71a"));
        for(int z=-5;z<=5;z+=2)DrawLine(At(-12,z),At(12,z),new Color("c6cea71a"));
        if(Current.ValueKind!=JsonValueKind.Object)return;
        foreach(var zone in Current.GetProperty("zones").EnumerateArray())DrawCircle(At(Number(zone,"x"),Number(zone,"z")),(float)(Number(zone,"radius")*Size.Y/12),new Color("e6b77344"));
        foreach(var u in Current.GetProperty("units").EnumerateArray().OrderBy(u=>Number(u,"z"))){
            var p=InterpolatedPosition(u,"units");var hp=Number(u,"hp");var enemy=u.GetProperty("enemy").GetBoolean();
            var kind=u.GetProperty("kind").GetString()!;float size=Math.Clamp(Size.Y*.14f,32,54);
            var color=new Color(1,1,1,hp<=0?.25f:Number(u,"entry")>0?.55f:1);
            DrawCircle(p+new Vector2(0,4),size*.4f,new Color("142b2355"));
            if(sheets.TryGetValue(kind,out var sheet)){
                var source=Pose(u,VisualSeconds);
                DrawTextureRectRegion(sheet,new Rect2(p.X-size/2,p.Y-size,size,size),source,color);
            }else DrawCircle(p-new Vector2(0,size/2),size*.4f,color);
            if(hp>0){
                const float width=74;var top=p-new Vector2(width/2,size+16);
                DrawRect(new Rect2(top,new Vector2(width,7)),new Color("20372c"));
                DrawRect(new Rect2(top+Vector2.One,new Vector2((width-2)*(float)(hp/Number(u.GetProperty("attributes"),"MaxHp")),5)),new Color(enemy?"dd977a":"b4d3a1"));
                DrawRect(new Rect2(top+new Vector2(0,9),new Vector2(width,4)),new Color("20372c"));
                DrawRect(new Rect2(top+new Vector2(1,10),new Vector2((width-2)*(float)(Number(u,"energy")/1000),2)),new Color("f1ce7f"));
            }
            Text(names.GetValueOrDefault(kind,kind),p+new Vector2(0,22),18,new Color("fff2d4"));
            if(hp>0&&Number(u,"barrier")>0)DrawArc(p-new Vector2(0,size*.45f),size*.65f,0,Mathf.Tau,24,new Color("b6eddf"),2);
        }
        foreach(var projectile in Current.GetProperty("projectiles").EnumerateArray())DrawCircle(InterpolatedPosition(projectile,"projectiles"),4,new Color("ffe1a0"));
        var result=Current.GetProperty("result").GetString();
        if(result!=""){
            var panel=new Rect2(Size.X/2-210,8,420,56);DrawRect(panel,new Color("213d32ed"));
            Text(result=="victory"?$"第{FloorNumber}层 · 战斗胜利":$"战斗结束 · {result}",new Vector2(Size.X/2,48),28,new Color("f4e0a6"));
        }
        Text("自动普攻与技能 · 能量满1000可手动释放大招",new Vector2(20,Size.Y-14),17,new Color("e4e9ca"),false);
    }
}
