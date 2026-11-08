document.querySelector('#signupForm').addEventListener('submit',async event=>{
 event.preventDefault();const message=document.querySelector('#signupError'),button=document.querySelector('#createButton');message.textContent='';
 const password=document.querySelector('#password').value;
 if(password!==document.querySelector('#confirm').value){message.textContent='Passwords do not match.';return;}
 button.disabled=true;
 try{
  const email=document.querySelector('#email').value.trim();
  const created=await fetch('/api/auth/register',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});
  const result=await created.json();if(!created.ok)throw Error(result.error||'Could not create account.');
  const login=await fetch('/api/auth/login',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});
  if(!login.ok)throw Error('Account created. Return to sign in with your email and password.');
  location.assign('/');
 }catch(error){message.textContent=error.message;}finally{button.disabled=false;}
});
