// Host adapter only. QuickJS runs the identical bundled TS core.
#include "quickjs.h"
#include <stdlib.h>
#include <string.h>
typedef struct { JSRuntime *runtime; JSContext *context; JSValue call; char *error; } Tower;
static char *copy(const char *s) { size_t n=strlen(s)+1;char *p=malloc(n);if(p)memcpy(p,s,n);return p; }
static char *exception(JSContext *c) {
    JSValue e=JS_GetException(c);const char *s=JS_ToCString(c,e);
    char *out=copy(s?s:"QuickJS exception");if(s)JS_FreeCString(c,s);JS_FreeValue(c,e);return out;
}
void tower_destroy(Tower *t) {
    if(!t)return;
    if(t->context){JS_FreeValue(t->context,t->call);JS_FreeContext(t->context);}
    if(t->runtime)JS_FreeRuntime(t->runtime);
    free(t->error);free(t);
}
Tower *tower_create(const char *source) {
    Tower *t=calloc(1,sizeof(Tower));if(!t)return NULL;
    t->call=JS_UNDEFINED;t->runtime=JS_NewRuntime();if(!t->runtime){free(t);return NULL;}
    JS_SetMemoryLimit(t->runtime,256*1024*1024);JS_SetMaxStackSize(t->runtime,4*1024*1024);
    t->context=JS_NewContext(t->runtime);if(!t->context){tower_destroy(t);return NULL;}
    JSValue result=JS_Eval(t->context,source,strlen(source),"tower30-core.js",JS_EVAL_TYPE_GLOBAL);
    if(JS_IsException(result)){t->error=exception(t->context);return t;}JS_FreeValue(t->context,result);
    JSValue global=JS_GetGlobalObject(t->context),api=JS_GetPropertyStr(t->context,global,"Tower30Bridge");
    t->call=JS_GetPropertyStr(t->context,api,"call");JS_FreeValue(t->context,api);JS_FreeValue(t->context,global);
    if(!JS_IsFunction(t->context,t->call))t->error=copy("Missing Tower30Bridge.call");return t;
}
const char *tower_error(Tower *t){return t?t->error:"Failed to allocate QuickJS runtime";}
char *tower_call(Tower *t,const char *request) {
    if(!t||t->error)return NULL;
    JSValue arg=JS_NewString(t->context,request);
    JSValue result=JS_Call(t->context,t->call,JS_UNDEFINED,1,&arg);JS_FreeValue(t->context,arg);
    if(JS_IsException(result)){t->error=exception(t->context);return NULL;}
    const char *s=JS_ToCString(t->context,result);char *out=s?copy(s):NULL;
    if(s)JS_FreeCString(t->context,s);JS_FreeValue(t->context,result);return out;
}
void tower_free_string(char *p){free(p);}
