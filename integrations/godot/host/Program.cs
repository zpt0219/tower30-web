using Tower30;
if(args.Length!=3)throw new ArgumentException("generated-directory requests.jsonl responses.jsonl");
Console.WriteLine($"QuickJS host completed {Verify.Run(args[0],args[1],args[2])} requests");
