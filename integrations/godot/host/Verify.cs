using System;
using System.IO;
namespace Tower30;
public static class Verify
{
    public static int Run(string generated,string requests,string responses)
    {
        using var session=new QuickJsSession(generated);
        using var output=new StreamWriter(responses);
        var count=0;
        foreach(var line in File.ReadLines(requests)){
            output.WriteLine(session.CallRaw(line));count++;
        }
        return count;
    }
}
